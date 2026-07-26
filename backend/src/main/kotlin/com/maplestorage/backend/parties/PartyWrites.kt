package com.maplestorage.backend.parties

import com.maplestorage.backend.db.Party
import com.maplestorage.backend.db.PartyBoss
import com.maplestorage.backend.db.PartyMember
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.notInList
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.update
import kotlin.time.Instant
import kotlin.uuid.Uuid

// The per-party writes the grid save is built out of (see GridWrites.kt, which is the only caller
// and the only editing surface). Every function must run inside a transaction, on input the route
// has already validated.

/** One cell of the grid, resolved: who, on which character, and whether that character is yours. */
internal data class Seat(
    val personId: Uuid,
    // What the cell says, which may be a label for the character.
    val characterName: String,
    // Who that is, when the label is not the name. Null when the label is the name.
    val ign: String?,
    val characterId: Uuid?,
) {
    /** The name to look a sprite up by, and to link against the roster: the IGN if there is one. */
    val lookupName: String get() = ign ?: characterName
}

/** One row of the grid, resolved: what it is called, what it runs, and who is in it. */
internal data class PartyContent(
    val name: String?,
    val bossKeys: List<String>,
    val seats: List<Seat>,
)

internal fun createParty(
    userId: String,
    content: PartyContent,
    now: Instant,
    // character name -> sprite the Nexon lookup found, or null when it came back empty. Only names
    // actually looked up appear; the rest keep whatever the row already had.
    sprites: Map<String, String?> = emptyMap(),
): Uuid {
    val partyId = Uuid.random()
    Party.insert {
        it[id] = partyId
        it[Party.userId] = userId
        it[Party.name] = content.name?.trim()?.ifBlank { null }
        it[createdAt] = now
        it[updatedAt] = now
    }
    writeMembers(partyId, content.seats, sprites, now)
    writeBosses(partyId, content.bossKeys)
    return partyId
}

/**
 * Replaces the party's name, seats and bosses with what was submitted.
 *
 * Seats are matched to existing rows by PERSON, not by seat id: the grid's cell for (party,
 * person) is the same seat however the character in it changes. Keeping the row is what keeps a
 * loot payout pointing at somebody, so changing which character Jared brought must not re-create
 * the seat that says Jared was paid.
 */
internal fun saveParty(
    partyId: Uuid,
    userId: String,
    content: PartyContent,
    now: Instant,
    sprites: Map<String, String?> = emptyMap(),
) {
    Party.update({ (Party.id eq partyId) and (Party.userId eq userId) }) {
        it[Party.name] = content.name?.trim()?.ifBlank { null }
        it[updatedAt] = now
    }
    writeMembers(partyId, content.seats, sprites, now)
    writeBosses(partyId, content.bossKeys)
}

internal fun deleteParty(
    partyId: Uuid,
    userId: String,
): Boolean = Party.deleteWhere { (Party.id eq partyId) and (Party.userId eq userId) } > 0

private fun writeMembers(
    partyId: Uuid,
    seats: List<Seat>,
    sprites: Map<String, String?>,
    now: Instant,
) {
    val existing =
        PartyMember
            .selectAll()
            .where { PartyMember.partyId eq partyId }
            .associate { it[PartyMember.personId] to it[PartyMember.id] }

    val kept = seats.mapNotNull { existing[it.personId] }
    if (kept.isEmpty()) {
        PartyMember.deleteWhere { PartyMember.partyId eq partyId }
    } else {
        PartyMember.deleteWhere { (PartyMember.partyId eq partyId) and (PartyMember.id notInList kept) }
    }

    // Positions are rewritten from the submitted order every time, so they stay dense.
    seats.forEachIndexed { index, seat ->
        // A seat of yours reads its sprite off the character, so no copy is kept here: a copy
        // would go stale the moment the character's own sprite is refreshed.
        val looked = seat.characterId == null && sprites.containsKey(seat.lookupName)
        val seatId = existing[seat.personId]
        if (seatId == null) {
            PartyMember.insert {
                it[id] = Uuid.random()
                it[PartyMember.partyId] = partyId
                it[personId] = seat.personId
                it[name] = seat.characterName
                it[ign] = seat.ign
                it[characterId] = seat.characterId
                it[position] = index
                it[spriteImgUrl] = if (looked) sprites[seat.lookupName] else null
                it[spriteRefreshedAt] = if (looked) now else null
            }
        } else {
            PartyMember.update({ PartyMember.id eq seatId }) {
                it[name] = seat.characterName
                it[ign] = seat.ign
                it[characterId] = seat.characterId
                it[position] = index
                // Left alone unless this character was looked up just now, or the seat became one
                // of yours. Otherwise a save that only reorders columns would wipe every sprite.
                if (seat.characterId != null) {
                    it[spriteImgUrl] = null
                    it[spriteRefreshedAt] = null
                } else if (looked) {
                    it[spriteImgUrl] = sprites[seat.lookupName]
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
    // Validated before it gets here, so a missing key at this point is a bug, not user input. Same
    // reasoning as upsertBossClears: fail loudly rather than write a short list.
    val ids = bossIdsForKeys(bossKeys) ?: error("unvalidated boss keys reached writeBosses: $bossKeys")
    PartyBoss.deleteWhere { PartyBoss.partyId eq partyId }
    ids.values.forEach { bossId ->
        PartyBoss.insert {
            it[PartyBoss.partyId] = partyId
            it[bossCatalogId] = bossId
        }
    }
}
