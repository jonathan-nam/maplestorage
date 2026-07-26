package com.maplestorage.backend.parties

import com.maplestorage.backend.db.Party
import com.maplestorage.backend.db.PartyBoss
import com.maplestorage.backend.db.PartyMember
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.notInList
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.update
import kotlin.time.Instant
import kotlin.uuid.Uuid

// The writes behind /api/parties. A create and a save are the same operation with a different
// starting point: both replace the party's seats and bosses with what was submitted. Split from
// the reads in PartyQueries.kt only for size. Every function here must run inside a transaction,
// and takes input the route has already validated (see validateParty).

internal fun createParty(
    userId: String,
    request: SavePartyRequest,
    now: Instant,
    // name -> sprite found by the Nexon lookup, or null when the lookup came back empty. Only the
    // names that were actually looked up appear; the rest keep whatever the row already had.
    sprites: Map<String, String?> = emptyMap(),
): PartyResponse {
    val partyId = Uuid.random()
    Party.insert {
        it[id] = partyId
        it[Party.userId] = userId
        it[name] = request.name?.trim()?.ifBlank { null }
        it[createdAt] = now
        it[updatedAt] = now
    }
    writeMembers(partyId, request.members, sprites, now)
    writeBosses(partyId, request.bossKeys)
    return findPartyOrThrow(partyId, userId)
}

/**
 * Replaces the party's name, seats and bosses with what was submitted.
 *
 * Seats sent with an id are UPDATED in place; the rest of the party's seats are deleted. That
 * distinction is the point of the id: a payout row points at a member, so re-creating a seat on
 * every edit would silently drop who had already been paid.
 */
internal fun saveParty(
    partyId: Uuid,
    userId: String,
    request: SavePartyRequest,
    now: Instant,
    sprites: Map<String, String?> = emptyMap(),
) {
    Party.update({ (Party.id eq partyId) and (Party.userId eq userId) }) {
        it[name] = request.name?.trim()?.ifBlank { null }
        it[updatedAt] = now
    }
    writeMembers(partyId, request.members, sprites, now)
    writeBosses(partyId, request.bossKeys)
}

internal fun deleteParty(
    partyId: Uuid,
    userId: String,
): Boolean = Party.deleteWhere { (Party.id eq partyId) and (Party.userId eq userId) } > 0

private fun writeMembers(
    partyId: Uuid,
    members: List<PartyMemberRequest>,
    sprites: Map<String, String?>,
    now: Instant,
) {
    val kept = members.mapNotNull { it.id?.let(Uuid::parseOrNull) }
    if (kept.isEmpty()) {
        PartyMember.deleteWhere { PartyMember.partyId eq partyId }
    } else {
        PartyMember.deleteWhere { (PartyMember.partyId eq partyId) and (PartyMember.id notInList kept) }
    }

    // Positions are rewritten from the submitted order every time, so they stay dense.
    members.forEachIndexed { index, member ->
        val existing = member.id?.let(Uuid::parseOrNull)
        val characterId = member.characterId?.let(Uuid::parseOrNull)
        val seatName = member.name.trim()
        // A seat of yours reads its sprite off the character, so no copy is kept here: a copy
        // would go stale the moment the character's own sprite is refreshed.
        val looked = characterId == null && sprites.containsKey(seatName)
        if (existing == null) {
            PartyMember.insert {
                it[id] = Uuid.random()
                it[PartyMember.partyId] = partyId
                it[name] = seatName
                it[PartyMember.characterId] = characterId
                it[mvp] = member.mvp
                it[position] = index
                it[spriteImgUrl] = if (looked) sprites[seatName] else null
                it[spriteRefreshedAt] = if (looked) now else null
            }
        } else {
            PartyMember.update({ PartyMember.id eq existing }) {
                it[name] = seatName
                it[PartyMember.characterId] = characterId
                it[mvp] = member.mvp
                it[position] = index
                // Left alone unless this name was looked up just now, or the seat became one of
                // yours. Otherwise a save that only reorders seats would wipe every sprite.
                if (characterId != null) {
                    it[spriteImgUrl] = null
                    it[spriteRefreshedAt] = null
                } else if (looked) {
                    it[spriteImgUrl] = sprites[seatName]
                    it[spriteRefreshedAt] = now
                }
            }
        }
    }
}

private fun writeBosses(
    partyId: Uuid,
    bossKeys: List<String>,
) {
    // Validated by the route before it gets here, so a missing key at this point is a bug, not
    // user input. Same reasoning as upsertBossClears: fail loudly rather than write a short list.
    val ids = bossIdsForKeys(bossKeys) ?: error("unvalidated boss keys reached writeBosses: $bossKeys")
    PartyBoss.deleteWhere { PartyBoss.partyId eq partyId }
    ids.values.forEach { bossId ->
        PartyBoss.insert {
            it[PartyBoss.partyId] = partyId
            it[bossCatalogId] = bossId
        }
    }
}

private fun findPartyOrThrow(
    partyId: Uuid,
    userId: String,
): PartyResponse = findParty(partyId, userId) ?: error("party $partyId vanished between write and read")
