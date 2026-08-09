package com.maplestorage.backend.parties

import com.maplestorage.backend.db.Characters
import com.maplestorage.backend.db.PartyMember
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.update
import kotlin.uuid.Uuid

// A seat, written. Shared by the party's usual roster (PartyWrites.kt) and by one week's
// (PartyRoster.kt), because both are lists of character names that have to end up as the same
// rows: a seat is what a payout and a week's roster point at, so the two must never make one each
// for the same person. Inside a transaction, like the rest.

/** The name on a character of yours, which is the seat the config itself occupies. */
internal fun ownSeatName(ownCharacterId: Uuid): String =
    Characters
        .selectAll()
        .where { Characters.id eq ownCharacterId }
        .first()[Characters.name]

/**
 * The seats a roster names, YOUR character first.
 *
 * Read by the usual roster and by a week's, so the two cannot come to disagree about whether your
 * own character is in a party. They always are: the config IS that character, and they are usually
 * the seat that sold the drop, so leaving them out would make most sellers unnameable.
 */
internal fun seatNames(
    ownName: String,
    members: List<String>,
): List<String> = listOf(ownName) + members.map { it.trim() }.filterNot { it.equals(ownName, ignoreCase = true) }

/** Every seat this party has ever had, retired and guest ones included, by lowercased name. */
internal fun seatIdsByName(partyId: Uuid): Map<String, Uuid> =
    PartyMember
        .selectAll()
        .where { PartyMember.partyId eq partyId }
        .associate { it[PartyMember.name].lowercase() to it[PartyMember.id] }

/** Your own characters by lowercased name. A seat naming one is linked to it and shows its sprite. */
internal fun ownCharacterIds(userId: String): Map<String, Uuid> =
    Characters
        .selectAll()
        .where { Characters.userId eq userId }
        // Names are unique per world, so this cannot bind somebody else's character.
        .associate { it[Characters.name].lowercase() to it[Characters.id] }

/**
 * What a seat starts out as: in the usual roster or a guest, and what it takes of a split.
 *
 * One value rather than two parameters because both are the seat's standing, and both are read from
 * the same place at every call.
 */
internal data class NewSeat(
    val standing: Boolean,
    val shares: Int = 1,
)

internal fun insertSeat(
    partyId: Uuid,
    name: String,
    characterId: Uuid?,
    seatPosition: Int,
    seat: NewSeat,
    context: SeatContext,
): Uuid {
    val seatId = Uuid.random()
    // A seat of yours reads its sprite off the character, so no copy is kept here: a copy would go
    // stale the moment the character's own sprite is refreshed.
    val looked = characterId == null && context.sprites.containsKey(name)
    PartyMember.insert {
        it[id] = seatId
        it[PartyMember.partyId] = partyId
        it[PartyMember.name] = name
        it[PartyMember.characterId] = characterId
        it[position] = seatPosition
        it[standing] = seat.standing
        it[shares] = seat.shares
        it[spriteImgUrl] = if (looked) context.sprites[name] else null
        it[spriteRefreshedAt] = if (looked) context.now else null
    }
    return seatId
}

/**
 * Takes these seats out of the usual roster without taking them out of the record.
 *
 * A seat that a payout or a week's roster points at is RETIRED rather than deleted. Both reference
 * it with ON DELETE CASCADE, so deleting it would erase a debt, or rewrite a week that has already
 * been played, silently and in the same breath as an ordinary roster edit.
 *
 * A seat nothing points at is deleted, so correcting a misspelled name on the day it was typed does
 * not leave the misspelling sitting in the party forever.
 */
internal fun retireOrDelete(
    partyId: Uuid,
    leaving: Collection<Uuid>,
) {
    if (leaving.isEmpty()) return
    val pinned = seatsWithLootHistory(partyId) + seatsInAnyWeekRoster(partyId)
    val (retire, remove) = leaving.partition { it in pinned }
    if (remove.isNotEmpty()) PartyMember.deleteWhere { PartyMember.id inList remove }
    if (retire.isNotEmpty()) PartyMember.update({ PartyMember.id inList retire }) { it[standing] = false }
}

/**
 * Why this looter cannot be written, or null.
 *
 * Refused rather than dropped when the name is not in the party: a party believing one member loots
 * everything, with nothing recorded, is a pool that will quietly attribute the pieces to nobody.
 */
internal fun validateLooter(
    looterName: String?,
    ownCharacterId: Uuid?,
    members: List<String>,
): String? {
    if (looterName == null) return null
    val named =
        (listOfNotNull(ownCharacterId?.let(::ownSeatName)) + members)
            .map { it.trim().lowercase() }
            .toSet()
    return if (looterName.trim().lowercase() in named) {
        null
    } else {
        "whoever loots the pieces has to be somebody in this party"
    }
}
