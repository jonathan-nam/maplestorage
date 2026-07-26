package com.maplestorage.backend.parties

import com.maplestorage.backend.db.BossCatalog
import com.maplestorage.backend.db.Party
import com.maplestorage.backend.db.PartyBoss
import com.maplestorage.backend.db.PartyMember
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

/** Six seats, the game's own party limit. Enforced here because a CHECK cannot count siblings. */
internal const val MAX_PARTY_SIZE = 6

internal fun partiesFor(userId: String): List<PartyResponse> {
    val parties =
        Party
            .selectAll()
            .where { Party.userId eq userId }
            .orderBy(Party.createdAt)
            .toList()
    if (parties.isEmpty()) return emptyList()

    val partyIds = parties.map { it[Party.id] }
    // Two queries for the whole page rather than two per party. The lists are small, but the
    // per-party version is the one that turns a roster of eight into seventeen round trips.
    val membersByParty =
        PartyMember
            .selectAll()
            .where { PartyMember.partyId inList partyIds }
            .orderBy(PartyMember.position)
            .groupBy({ it[PartyMember.partyId] }) { it.toMemberResponse() }
    val bossKeysByParty =
        PartyBoss
            .innerJoin(BossCatalog)
            .selectAll()
            .where { PartyBoss.partyId inList partyIds }
            .orderBy(BossCatalog.sortOrder)
            .groupBy({ it[PartyBoss.partyId] }) { it[BossCatalog.bossKey] }

    return parties.map { row ->
        val id = row[Party.id]
        row.toPartyResponse(membersByParty[id].orEmpty(), bossKeysByParty[id].orEmpty())
    }
}

internal fun findParty(
    partyId: Uuid,
    userId: String,
): PartyResponse? {
    val row =
        Party
            .selectAll()
            .where { (Party.id eq partyId) and (Party.userId eq userId) }
            .firstOrNull() ?: return null
    return row.toPartyResponse(membersOf(partyId), bossKeysOf(partyId))
}

/** True when the party exists and belongs to this user. The ownership check every write starts with. */
internal fun ownsParty(
    partyId: Uuid,
    userId: String,
): Boolean =
    Party
        .selectAll()
        .where { (Party.id eq partyId) and (Party.userId eq userId) }
        .empty()
        .not()

private fun membersOf(partyId: Uuid): List<PartyMemberResponse> =
    PartyMember
        .selectAll()
        .where { PartyMember.partyId eq partyId }
        .orderBy(PartyMember.position)
        .map { it.toMemberResponse() }

private fun bossKeysOf(partyId: Uuid): List<String> =
    PartyBoss
        .innerJoin(BossCatalog)
        .selectAll()
        .where { PartyBoss.partyId eq partyId }
        .orderBy(BossCatalog.sortOrder)
        .map { it[BossCatalog.bossKey] }

private fun ResultRow.toMemberResponse() =
    PartyMemberResponse(
        id = this[PartyMember.id].toString(),
        name = this[PartyMember.name],
        characterId = this[PartyMember.characterId]?.toString(),
        mvp = this[PartyMember.mvp],
    )

private fun ResultRow.toPartyResponse(
    members: List<PartyMemberResponse>,
    bossKeys: List<String>,
) = PartyResponse(
    id = this[Party.id].toString(),
    name = this[Party.name],
    members = members,
    bossKeys = bossKeys,
    createdAt = this[Party.createdAt].toString(),
    updatedAt = this[Party.updatedAt].toString(),
)
