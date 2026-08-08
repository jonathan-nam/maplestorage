package com.maplestorage.backend.parties

import com.maplestorage.backend.bosses.periodStartFor
import com.maplestorage.backend.db.BossCatalog
import com.maplestorage.backend.db.BossClear
import com.maplestorage.backend.db.Characters
import com.maplestorage.backend.db.Party
import com.maplestorage.backend.db.PartyMember
import com.maplestorage.backend.db.Person
import com.maplestorage.backend.db.PersonCharacter
import com.maplestorage.backend.users.WORLD_INTERACTIVE
import kotlinx.datetime.LocalDate
import org.jetbrains.exposed.v1.core.JoinType
import org.jetbrains.exposed.v1.core.Op
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

/** Ten hours, longer than any night. A typo guard, not a claim about how long a boss takes. */
internal const val MAX_RUN_MINUTES = 600

/**
 * Every config, with its pool counted and its roster read for one week.
 *
 * [week] is the week being shown, or null for the live view, which is this week. Which CONFIGS
 * there are does not move with it (the party table has no period), and neither does `cleared`,
 * which answers for the period the config is in now: Party View reads the clears endpoint rather
 * than this field on a past week.
 *
 * The roster does move with it. A week somebody guested in ran a different party from the usual
 * one, and drawing today's roster over it would name people who were not there.
 *
 * Solo configs are left out unless [includeSolo]. They are pools, not parties, and every caller
 * that draws a roster, plans a night around one or attributes a seat to a person would be showing
 * a party of one. The Drop Log asks for them, because a drop is exactly what they hold.
 *
 * Retired configs are left out unless [includeRetired]. They are bosses this character no longer
 * runs, so no list that answers "what is on this week" should carry them. The two callers that
 * read POOLS rather than lists ask for them, and must: the wallet and the Drop Log both key their
 * loot rows off the configs they are handed, so leaving one out turns an outstanding split into a
 * debt nobody owes. See V33__party_standing.sql.
 */
internal fun partiesFor(
    userId: String,
    week: LocalDate? = null,
    includeSolo: Boolean = false,
    includeRetired: Boolean = false,
): List<PartyResponse> {
    val wanted =
        (if (includeSolo) Op.TRUE else (Party.solo eq false)) and
            (if (includeRetired) Op.TRUE else (Party.standing eq true))
    val rows =
        Party
            .innerJoin(BossCatalog)
            // The config's own character, for its world. Named columns rather than the FK-inferred
            // overload: party_member also references characters, so "which link" is worth stating.
            .join(Characters, JoinType.INNER, Party.characterId, Characters.id)
            .selectAll()
            .where { (Party.userId eq userId) and wanted }
            .orderBy(BossCatalog.sortOrder)
            .toList()
    if (rows.isEmpty()) return emptyList()

    val shown = week ?: currentWeek()
    val partyIds = rows.map { it[Party.id] }
    val seatsByParty = seatsFor(partyIds, userId)
    val rosters = rostersFor(partyIds, shown)
    val counts = lootCountsFor(partyIds, shown)
    val clears = clearStateFor(rows)
    val spelledOut = weeksSpelledOut(partyIds, shown)
    // Against the week being SHOWN, not against now, so stepping back says what was said about that
    // week rather than what is true today. The trap `cleared` falls into: see clearStateFor.
    val off = notRunningIn(rows, week, Clock.System.now())

    return rows.map { row ->
        val id = row[Party.id]
        val seats = seatsByParty[id].orEmpty()
        row.toPartyResponse(
            members = ranIn(seats, rosters[id].orEmpty()),
            seats = seats,
            loot = counts[id] ?: LootCounts(0, 0, 0),
            clear = clears[id] ?: ClearState(null, false),
            usualRoster = id !in spelledOut,
            skippedThisPeriod = id in off,
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
    // This week's roster, because this is the page a drop is added and sold on, and those land in
    // the week it is now. The pool below it is all time, so an old drop stays settleable, and it
    // reads its payouts against `seats` rather than this.
    val week = currentWeek()
    val seats = seatsFor(listOf(partyId), userId)[partyId].orEmpty()
    return row.toPartyResponse(
        members = ranIn(seats, rosterFor(partyId, week)),
        seats = seats,
        // All time, unlike the list's. This is the page that sells a drop and pays it out, so a
        // week that hid an old one would put it beyond the only controls that can settle it.
        loot = lootCountsFor(listOf(partyId), week = null)[partyId] ?: LootCounts(0, 0, 0),
        clear = clearStateFor(listOf(row))[partyId] ?: ClearState(null, false),
        usualRoster = partyId !in weeksSpelledOut(listOf(partyId), week),
        // The live view, which is the only one this reads: the period the boss is in now, which for
        // a monthly boss is not the month `week` started in. See periodShown.
        skippedThisPeriod = partyId in notRunningIn(listOf(row), week = null, now = Clock.System.now()),
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
 * EVERY seat these configs have, in seat order, with whose character each one is.
 *
 * All of them, guests and retired members included, because this is what a payout is read against:
 * a share owed to somebody who has since left the party is still owed, and resolving it through
 * this week's roster would turn the drop unreadable the moment the week rolled over. Who ran a
 * given week is a narrowing of this, not a different query. See ranIn.
 *
 * The person comes from person_character, matched on the seat's character NAME: that association
 * is account-wide and stated once, so a seat naming CreedBratton shows Chris in every config
 * without storing him on each of them.
 */
private fun seatsFor(
    partyIds: List<Uuid>,
    userId: String,
): Map<Uuid, List<PartyMemberResponse>> {
    if (partyIds.isEmpty()) return emptyMap()
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
                guest = !row[PartyMember.standing],
            )
        }
}

/**
 * The seats out of [seats] that ran in a week, in seat order.
 *
 * A narrowing rather than a second query, so "who ran that week" can never name somebody the pool
 * cannot read a payout against.
 */
private fun ranIn(
    seats: List<PartyMemberResponse>,
    roster: List<Uuid>,
): List<PartyMemberResponse> {
    val ran = roster.map { it.toString() }.toSet()
    return seats.filter { it.id in ran }
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

private fun ResultRow.toPartyResponse(
    members: List<PartyMemberResponse>,
    seats: List<PartyMemberResponse>,
    loot: LootCounts,
    clear: ClearState,
    usualRoster: Boolean,
    skippedThisPeriod: Boolean,
) = PartyResponse(
    id = this[Party.id].toString(),
    characterId = this[Party.characterId].toString(),
    worldType = this[Characters.worldType],
    bossKey = this[BossCatalog.bossKey],
    difficulty = this[Party.difficulty],
    minutes = this[Party.minutes],
    solo = this[Party.solo],
    oneOff = this[Party.oneOff],
    retired = !this[Party.standing],
    members = members,
    seats = seats,
    usualRoster = usualRoster,
    skippedThisPeriod = skippedThisPeriod,
    pendingLoot = loot.pending,
    awaitingPayout = loot.awaitingPayout,
    settledLoot = loot.settled,
    cleared = clear.cleared,
    clearedByHand = clear.byHand,
    createdAt = this[Party.createdAt].toString(),
    updatedAt = this[Party.updatedAt].toString(),
)
