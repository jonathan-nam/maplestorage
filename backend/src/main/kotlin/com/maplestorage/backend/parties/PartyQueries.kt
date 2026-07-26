package com.maplestorage.backend.parties

import com.maplestorage.backend.db.BossCatalog
import com.maplestorage.backend.db.Characters
import com.maplestorage.backend.db.Party
import com.maplestorage.backend.db.PartyLoot
import com.maplestorage.backend.db.PartyLootPayout
import com.maplestorage.backend.db.PartyMember
import com.maplestorage.backend.db.Person
import com.maplestorage.backend.db.PersonCharacter
import org.jetbrains.exposed.v1.core.JoinType
import org.jetbrains.exposed.v1.core.ResultRow
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.jdbc.selectAll
import kotlin.uuid.Uuid

// The reads behind /api/parties. `internal` rather than private, as the boss and token queries
// are, so the tests exercise these exact queries instead of a re-typed copy: the ownership filter
// is the thing most likely to be quietly wrong. Writes are in PartyWrites.kt.
// All of these must be called from inside a `transaction { }` block.

/** Six seats, the game's own party limit, so five OTHERS at most beside your own character. */
internal const val MAX_PARTY_SIZE = 6

internal fun partiesFor(userId: String): List<PartyResponse> {
    val rows =
        Party
            .innerJoin(BossCatalog)
            .selectAll()
            .where { Party.userId eq userId }
            .orderBy(BossCatalog.sortOrder)
            .toList()
    if (rows.isEmpty()) return emptyList()

    val partyIds = rows.map { it[Party.id] }
    val membersByParty = membersFor(partyIds, userId)
    val counts = lootCountsFor(partyIds)

    return rows.map { row ->
        val id = row[Party.id]
        row.toPartyResponse(membersByParty[id].orEmpty(), counts[id] ?: LootCounts(0, 0))
    }
}

internal fun findParty(
    partyId: Uuid,
    userId: String,
): PartyResponse? {
    val row =
        Party
            .innerJoin(BossCatalog)
            .selectAll()
            .where { (Party.id eq partyId) and (Party.userId eq userId) }
            .firstOrNull() ?: return null
    return row.toPartyResponse(
        membersFor(listOf(partyId), userId)[partyId].orEmpty(),
        lootCountsFor(listOf(partyId))[partyId] ?: LootCounts(0, 0),
    )
}

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
                spriteImgUrl = row.getOrNull(Characters.spriteImgUrl) ?: row[PartyMember.spriteImgUrl],
            )
        }
}

/** Unsold drops, and sold ones with somebody still unpaid. */
internal data class LootCounts(
    val pending: Int,
    val awaitingPayout: Int,
)

/**
 * The two pool counts per config, in two queries for the whole page.
 *
 * "Awaiting payout" is derived the same way the loot rows derive their status: sold, and at least
 * one payout row unpaid. Deriving it in one place and storing it in none is what keeps the card's
 * badge and the drop's own status from disagreeing.
 */
internal fun lootCountsFor(partyIds: List<Uuid>): Map<Uuid, LootCounts> {
    val loot =
        if (partyIds.isEmpty()) {
            emptyList()
        } else {
            PartyLoot
                .selectAll()
                .where { PartyLoot.partyId inList partyIds }
                .map { Triple(it[PartyLoot.id], it[PartyLoot.partyId], it[PartyLoot.soldAt] != null) }
        }
    if (loot.isEmpty()) return emptyMap()

    val unpaidLootIds =
        PartyLootPayout
            .selectAll()
            .where { (PartyLootPayout.lootId inList loot.map { it.first }) and (PartyLootPayout.paid eq false) }
            .map { it[PartyLootPayout.lootId] }
            .toSet()

    return loot
        .groupBy { it.second }
        .mapValues { (_, rows) ->
            LootCounts(
                pending = rows.count { !it.third },
                awaitingPayout = rows.count { it.third && it.first in unpaidLootIds },
            )
        }
}

private fun ResultRow.toPartyResponse(
    members: List<PartyMemberResponse>,
    loot: LootCounts,
) = PartyResponse(
    id = this[Party.id].toString(),
    characterId = this[Party.characterId].toString(),
    bossKey = this[BossCatalog.bossKey],
    name = this[Party.name],
    members = members,
    pendingLoot = loot.pending,
    awaitingPayout = loot.awaitingPayout,
    createdAt = this[Party.createdAt].toString(),
    updatedAt = this[Party.updatedAt].toString(),
)
