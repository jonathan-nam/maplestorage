package com.maplestorage.backend.parties

import com.maplestorage.backend.bosses.weekOf
import com.maplestorage.backend.db.Party
import com.maplestorage.backend.db.PartyLoot
import com.maplestorage.backend.db.PartyMember
import com.maplestorage.backend.db.PartyWeekSeat
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.update
import kotlin.time.Instant
import kotlin.uuid.Uuid

// The config for a boss run alone. Held apart from PartyWrites.kt because a solo pool is the one
// config that is not a party, and every rule that makes it one lives here: how a drop finds it, how
// it is opened, and what has to be pinned before it becomes an ordinary party.
//
// Inside a transaction, like the rest. See V30__party_solo.sql.

/**
 * The config this character has for this boss, party or solo, or null when there is none.
 *
 * What "log a drop on this boss" resolves to. One config per pair (see V22__party_config.sql), so
 * this cannot be a choice between two.
 */
internal fun partyIdFor(
    characterId: Uuid,
    bossCatalogId: Uuid,
): Uuid? =
    Party
        .selectAll()
        .where { (Party.characterId eq characterId) and (Party.bossCatalogId eq bossCatalogId) }
        .firstOrNull()
        ?.get(Party.id)

/** True when this config has one seat because nobody else was there. */
internal fun isSoloParty(partyId: Uuid): Boolean =
    Party
        .selectAll()
        .where { Party.id eq partyId }
        .firstOrNull()
        ?.get(Party.solo) == true

/**
 * Opens the pool for a boss this character ran alone.
 *
 * One seat, so a drop has an owner to be sold by and the split has a party to be read against. It
 * is not a party and does not claim to be one: no difficulty (nobody said), no run time, and off
 * every list of parties.
 *
 * The "doesn't run" mark, if there is one, is left alone on purpose. A boss killed once is not a
 * boss added to the routine, and addLoot's clear already shows this week's tick over the mark. See
 * setBossRoutine.
 */
internal fun createSoloParty(
    userId: String,
    characterId: Uuid,
    bossCatalogId: Uuid,
    now: Instant,
): Uuid {
    val partyId = Uuid.random()
    Party.insert {
        it[id] = partyId
        it[Party.userId] = userId
        it[Party.characterId] = characterId
        it[Party.bossCatalogId] = bossCatalogId
        it[solo] = true
        it[createdAt] = now
        it[updatedAt] = now
    }
    writeMembers(partyId, characterId, emptyList(), SeatContext(userId, emptyMap(), now))
    return partyId
}

/**
 * The pool a drop on this character and boss belongs in, opened if it is not there yet.
 *
 * The config this character has for the boss takes it, party or solo, so logging a drop from the
 * Drop Log cannot open a second pool beside the party's. One config per pair is what makes that a
 * lookup rather than a choice.
 */
internal fun poolFor(
    userId: String,
    characterId: Uuid,
    bossCatalogId: Uuid,
    now: Instant,
): Uuid = partyIdFor(characterId, bossCatalogId) ?: createSoloParty(userId, characterId, bossCatalogId, now)

/**
 * Turns a solo pool into the party it now is, without back-dating the new seats onto its drops.
 *
 * Every week that already holds a drop is spelled out first, naming the seat that was there alone.
 * Without it, selling one of those drops later would read the roster as it stands NOW, and owe a
 * share to somebody who was not in the game that night.
 */
internal fun adoptSoloParty(
    userId: String,
    partyId: Uuid,
    request: SavePartyRequest,
    now: Instant,
    sprites: Map<String, String?> = emptyMap(),
) {
    pinWeeksAlreadyDropped(partyId)
    Party.update({ Party.id eq partyId }) { it[solo] = false }
    saveParty(userId, partyId, request, now, sprites)
}

/** Spells out every week this pool already has a drop in, as the seats it has right now. */
private fun pinWeeksAlreadyDropped(partyId: Uuid) {
    val seats = PartyMember.selectAll().where { PartyMember.partyId eq partyId }.map { it[PartyMember.id] }
    val spelledOut = weeksSpelledOutFor(partyId)
    PartyLoot
        .selectAll()
        .where { PartyLoot.partyId eq partyId }
        .map { weekOf(it[PartyLoot.droppedOn]) }
        .distinct()
        .filterNot { it in spelledOut }
        .forEach { week ->
            seats.forEach { seatId ->
                PartyWeekSeat.insert {
                    it[PartyWeekSeat.partyId] = partyId
                    it[weekStart] = week
                    it[memberId] = seatId
                }
            }
        }
}
