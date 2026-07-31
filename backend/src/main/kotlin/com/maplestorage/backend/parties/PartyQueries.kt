package com.maplestorage.backend.parties

import com.maplestorage.backend.bosses.WEEKLY_CADENCE
import com.maplestorage.backend.bosses.periodAfter
import com.maplestorage.backend.bosses.periodStartFor
import com.maplestorage.backend.db.BossCatalog
import com.maplestorage.backend.db.BossClear
import com.maplestorage.backend.db.Characters
import com.maplestorage.backend.db.Party
import com.maplestorage.backend.db.PartyLoot
import com.maplestorage.backend.db.PartyLootPayout
import com.maplestorage.backend.db.PartyMember
import com.maplestorage.backend.db.Person
import com.maplestorage.backend.db.PersonCharacter
import com.maplestorage.backend.users.WORLD_INTERACTIVE
import kotlinx.datetime.LocalDate
import org.jetbrains.exposed.v1.core.JoinType
import org.jetbrains.exposed.v1.core.ResultRow
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.jdbc.selectAll
import kotlin.time.Clock
import kotlin.uuid.Uuid

// The reads behind /api/parties. `internal` rather than private, as the boss and token queries
// are, so the tests exercise these exact queries instead of a re-typed copy: the ownership filter
// is the thing most likely to be quietly wrong. Writes are in PartyWrites.kt.
// All of these must be called from inside a `transaction { }` block.

/** Six seats, the game's own party limit, so five OTHERS at most beside your own character. */
internal const val MAX_PARTY_SIZE = 6

/**
 * Every config, with its pool counted for one week.
 *
 * [week] is the week being shown, or null for the live view, which is this week. The configs
 * themselves are not history and do not move with it (the party table has no period), so what the
 * week changes is only the three loot counters each row carries. `cleared` likewise answers for the
 * period the config is in NOW, and Party View reads the clears endpoint rather than this field on a
 * past week.
 */
internal fun partiesFor(
    userId: String,
    week: LocalDate? = null,
): List<PartyResponse> {
    val rows =
        Party
            .innerJoin(BossCatalog)
            // The config's own character, for its world. Named columns rather than the FK-inferred
            // overload: party_member also references characters, so "which link" is worth stating.
            .join(Characters, JoinType.INNER, Party.characterId, Characters.id)
            .selectAll()
            .where { Party.userId eq userId }
            .orderBy(BossCatalog.sortOrder)
            .toList()
    if (rows.isEmpty()) return emptyList()

    val partyIds = rows.map { it[Party.id] }
    val membersByParty = membersFor(partyIds, userId)
    val counts = lootCountsFor(partyIds, week ?: periodStartFor(WEEKLY_CADENCE, Clock.System.now()))
    val clears = clearStateFor(rows)

    return rows.map { row ->
        val id = row[Party.id]
        row.toPartyResponse(
            membersByParty[id].orEmpty(),
            counts[id] ?: LootCounts(0, 0, 0),
            clears[id] ?: ClearState(null, false),
        )
    }
}

internal fun findParty(
    partyId: Uuid,
    userId: String,
): PartyResponse? {
    val row =
        Party
            .innerJoin(BossCatalog)
            .join(Characters, JoinType.INNER, Party.characterId, Characters.id)
            .selectAll()
            .where { (Party.id eq partyId) and (Party.userId eq userId) }
            .firstOrNull() ?: return null
    return row.toPartyResponse(
        membersFor(listOf(partyId), userId)[partyId].orEmpty(),
        // All time, unlike the list's. This is the page that sells a drop and pays it out, so a
        // week that hid an old one would put it beyond the only controls that can settle it.
        lootCountsFor(listOf(partyId), week = null)[partyId] ?: LootCounts(0, 0, 0),
        clearStateFor(listOf(row))[partyId] ?: ClearState(null, false),
    )
}

/**
 * True when this config's drops can be sold at all.
 *
 * Heroic (Reboot) worlds do not trade, so a sale there is not a figure to get right, it is one
 * that could never have happened. The UI hides the control; this is what makes hiding it a rule
 * rather than a suggestion, and without it the payout rows a sale pins would outlive the button.
 */
internal fun partyCanSell(partyId: Uuid): Boolean =
    Party
        .join(Characters, JoinType.INNER, Party.characterId, Characters.id)
        .selectAll()
        .where { Party.id eq partyId }
        .firstOrNull()
        ?.get(Characters.worldType) == WORLD_INTERACTIVE

/** True when the config exists and belongs to this user. The ownership check every write starts with. */
internal fun ownsParty(
    partyId: Uuid,
    userId: String,
): Boolean =
    Party
        .selectAll()
        .where { (Party.id eq partyId) and (Party.userId eq userId) }
        .empty()
        .not()

internal fun peopleFor(userId: String): List<PersonResponse> {
    val people =
        Person
            .selectAll()
            .where { Person.userId eq userId }
            .orderBy(Person.createdAt)
            .toList()
    if (people.isEmpty()) return emptyList()

    val charactersByPerson =
        PersonCharacter
            .selectAll()
            .where { PersonCharacter.userId eq userId }
            .orderBy(PersonCharacter.name)
            .groupBy({ it[PersonCharacter.personId] }) { it[PersonCharacter.name] }

    return people.map {
        PersonResponse(
            id = it[Person.id].toString(),
            name = it[Person.name],
            characters = charactersByPerson[it[Person.id]].orEmpty(),
        )
    }
}

/**
 * Seats for these configs, with whose character each one is.
 *
 * The person comes from person_character, matched on the seat's character NAME: that association
 * is account-wide and stated once, so a seat naming CreedBratton shows Chris in every config
 * without storing him on each of them.
 */
private fun membersFor(
    partyIds: List<Uuid>,
    userId: String,
): Map<Uuid, List<PartyMemberResponse>> {
    // Every sprite this account has found, by character name. A sprite belongs to the CHARACTER,
    // not to the seat: the same person in three configs is the same character, and looking them up
    // once means the other two seats have a null of their own. Reading through this map is what
    // makes a character look the same in every party they are in.
    val spritesByName =
        seatSpritesByCharacter(userId)
            .mapNotNull { (name, seat) ->
                seat.spriteImgUrl?.let { name.lowercase() to it }
            }.toMap()

    val owners =
        PersonCharacter
            .innerJoin(Person)
            .selectAll()
            .where { PersonCharacter.userId eq userId }
            .associate {
                it[PersonCharacter.name].lowercase() to
                    (it[Person.id].toString() to it[Person.name])
            }

    return PartyMember
        .join(Characters, JoinType.LEFT, PartyMember.characterId, Characters.id)
        .selectAll()
        .where { PartyMember.partyId inList partyIds }
        .orderBy(PartyMember.position)
        .groupBy({ it[PartyMember.partyId] }) { row ->
            val owner = owners[row[PartyMember.name].lowercase()]
            PartyMemberResponse(
                id = row[PartyMember.id].toString(),
                name = row[PartyMember.name],
                personId = owner?.first,
                personName = owner?.second,
                characterId = row[PartyMember.characterId]?.toString(),
                spriteImgUrl = spriteFor(row, spritesByName),
            )
        }
}

/**
 * Whether this config's boss is cleared in the period it is currently in, and how that was known.
 *
 * Read from boss_clear, the same table the clear matrix reads and a planner capture writes. That
 * is the whole of the sync between the two pages: there is one answer to "is Kalos done this week
 * on mechyfechy", and both views are looking at it rather than keeping their own.
 *
 * `cleared` is null when no row exists, which is not the same as false: false means a capture or a
 * tick SAID it is not done, null means nobody has said anything this period.
 */
internal data class ClearState(
    val cleared: Boolean?,
    // No source screenshot, so it was ticked by hand rather than read off a planner. Worth showing:
    // a number you can trace to a capture and one somebody typed are not equally trustworthy.
    val byHand: Boolean,
)

private fun clearStateFor(rows: List<ResultRow>): Map<Uuid, ClearState> {
    if (rows.isEmpty()) return emptyMap()
    val now = Clock.System.now()

    // Per boss, because cadences differ: a weekly and a monthly boss are in different periods at
    // the same instant, and filtering on one date would answer for the other only on the day they
    // happen to coincide.
    val wanted =
        rows.associate { row ->
            row[Party.id] to
                Triple(
                    row[Party.characterId],
                    row[Party.bossCatalogId],
                    periodStartFor(row[BossCatalog.reset], now),
                )
        }

    val found =
        BossClear
            .selectAll()
            .where { BossClear.characterId inList wanted.values.map { it.first }.distinct() }
            .associateBy {
                Triple(
                    it[BossClear.characterId],
                    it[BossClear.bossCatalogId],
                    it[BossClear.periodStart],
                )
            }

    return wanted.mapValues { (_, key) ->
        val row = found[key]
        ClearState(row?.get(BossClear.cleared), row != null && row[BossClear.sourceScreenshotId] == null)
    }
}

/**
 * The sprite to draw for a seat: the roster's own for one of your characters, then this seat's,
 * then whatever this account has found for that character NAME anywhere else.
 *
 * The last one matters. A character named in three configs is looked up once, so the other two
 * seats hold a null of their own, and reading only the seat left the same person drawn in one row
 * and blank in the next two.
 */
private fun spriteFor(
    row: ResultRow,
    spritesByName: Map<String, String>,
): String? =
    row.getOrNull(Characters.spriteImgUrl)
        ?: row[PartyMember.spriteImgUrl]
        ?: spritesByName[row[PartyMember.name].lowercase()]

/** Unsold drops, sold ones with somebody still unpaid, and ones with nothing left to do. */
internal data class LootCounts(
    val pending: Int,
    val awaitingPayout: Int,
    // Sold and everybody paid. Carried so a pool that is fully settled is still VISIBLE from the
    // list: with only the two counters above, marking the last share paid made a party's whole
    // drop history vanish from its row, and there was nothing to say the pool was not empty.
    val settled: Int,
)

private data class LootRow(
    val id: Uuid,
    val partyId: Uuid,
    val droppedOn: LocalDate,
    val sold: Boolean,
)

/**
 * The pool counts per config, for one week or for all time.
 *
 * A null [week] counts every drop the pool has ever held, which is what the party's own page and
 * the delete guard want. Otherwise a drop belongs to the week it fell in, so a week that has passed
 * shows the pool it had rather than today's.
 *
 * Outstanding drops are the one exception to that, and they carry FORWARD: something unsold, or
 * sold with somebody still unpaid, is work left to do rather than history, so it keeps counting in
 * every later week until it settles. Otherwise a drop from last week that still owes somebody money
 * would disappear from Party View entirely, which is the silent-omission failure this repo exists
 * to prevent.
 *
 * Nothing carries backwards. A drop that fell after the week being shown is not in that week, so a
 * settled pool stays settled when you step back to it.
 *
 * "Awaiting payout" is derived the same way the loot rows derive their status: sold, and at least
 * one payout row unpaid. Deriving it in one place and storing it in none is what keeps the card's
 * badge and the drop's own status from disagreeing.
 */
internal fun lootCountsFor(
    partyIds: List<Uuid>,
    week: LocalDate?,
): Map<Uuid, LootCounts> {
    val loot =
        if (partyIds.isEmpty()) {
            emptyList()
        } else {
            PartyLoot
                .selectAll()
                .where { PartyLoot.partyId inList partyIds }
                .map {
                    LootRow(
                        it[PartyLoot.id],
                        it[PartyLoot.partyId],
                        it[PartyLoot.droppedOn],
                        it[PartyLoot.soldAt] != null,
                    )
                }
        }
    if (loot.isEmpty()) return emptyMap()

    val unpaidLootIds =
        PartyLootPayout
            .selectAll()
            .where { (PartyLootPayout.lootId inList loot.map { it.id }) and (PartyLootPayout.paid eq false) }
            .map { it[PartyLootPayout.lootId] }
            .toSet()

    // Through periodAfter rather than a +7, so the week a drop is filed under and the week the
    // stepper walks cannot drift apart.
    val weekEnd = week?.let { periodAfter(WEEKLY_CADENCE, it) }

    // Two windows, and the difference between them is the carry-forward. Outstanding drops count
    // from the week they fell in onwards; settled ones count in that week alone.
    val byThen = { row: LootRow -> weekEnd == null || row.droppedOn < weekEnd }
    val inWeek = { row: LootRow -> week == null || (row.droppedOn >= week && byThen(row)) }

    return loot
        .groupBy { it.partyId }
        .mapValues { (_, rows) ->
            LootCounts(
                pending = rows.count { !it.sold && byThen(it) },
                awaitingPayout = rows.count { it.sold && it.id in unpaidLootIds && byThen(it) },
                settled = rows.count { it.sold && it.id !in unpaidLootIds && inWeek(it) },
            )
        }
}

private fun ResultRow.toPartyResponse(
    members: List<PartyMemberResponse>,
    loot: LootCounts,
    clear: ClearState,
) = PartyResponse(
    id = this[Party.id].toString(),
    characterId = this[Party.characterId].toString(),
    worldType = this[Characters.worldType],
    bossKey = this[BossCatalog.bossKey],
    difficulty = this[Party.difficulty],
    members = members,
    pendingLoot = loot.pending,
    awaitingPayout = loot.awaitingPayout,
    settledLoot = loot.settled,
    cleared = clear.cleared,
    clearedByHand = clear.byHand,
    createdAt = this[Party.createdAt].toString(),
    updatedAt = this[Party.updatedAt].toString(),
)
