package com.maplestorage.backend.parties

import com.maplestorage.backend.db.Characters
import com.maplestorage.backend.db.Party
import com.maplestorage.backend.db.PartyLoot
import com.maplestorage.backend.db.PartyMember
import com.maplestorage.backend.db.Person
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.update
import kotlin.time.Instant
import kotlin.uuid.Uuid

// Saving the whole grid: columns (people), rows (parties) and the character in each filled cell.
// One writer for the roster, because two would be two ways for it to disagree with itself.
// Inside a transaction, on input validateGrid has already accepted.

internal fun peopleFor(userId: String): List<PersonResponse> =
    Person
        .selectAll()
        .where { Person.userId eq userId }
        .orderBy(Person.createdAt)
        .map { PersonResponse(it[Person.id].toString(), it[Person.name], it[Person.mvp]) }

internal fun gridFor(userId: String): PartyGridResponse = PartyGridResponse(peopleFor(userId), partiesFor(userId))

/**
 * Applies the submitted grid, and answers with what it now is.
 *
 * A full replace: a row or column absent from the payload has been removed. Removals that loot
 * history points at are refused by validateGrid before anything is written, so this never has to
 * choose between deleting a payout record and half-applying a save.
 */
internal fun saveGrid(
    userId: String,
    request: SaveGridRequest,
    now: Instant,
    sprites: Map<String, String?> = emptyMap(),
): PartyGridResponse {
    val personIdByKey = writePeople(userId, request.people, now)

    // Your own characters, by lowercased name: a cell holding one of your characters' names is
    // linked to it, so the seat shows the roster's sprite and the character's parties can be found.
    // Names are unique per world in the game, so this cannot bind somebody else's character.
    val mine =
        Characters
            .selectAll()
            .where { Characters.userId eq userId }
            .associate { it[Characters.name].lowercase() to it[Characters.id] }

    val keptParties = mutableListOf<Uuid>()
    for (party in request.parties) {
        val seats =
            party.seats.map { seat ->
                val label = seat.characterName.trim()
                val ign = seat.ign?.trim()?.ifBlank { null }
                Seat(
                    personId = personIdByKey.getValue(seat.personKey),
                    characterName = label,
                    ign = ign,
                    // Matched on the IGN, since that is the name your roster is keyed by. A label
                    // like "2nd mech" matches nothing, which is the point of carrying both.
                    characterId = mine[(ign ?: label).lowercase()],
                )
            }
        val content = PartyContent(party.name, party.bossKeys, seats)
        val partyId = party.id?.let(Uuid::parseOrNull)
        if (partyId == null) {
            keptParties += createParty(userId, content, now, sprites)
        } else {
            saveParty(partyId, userId, content, now, sprites)
            keptParties += partyId
        }
    }

    deleteAbsentParties(userId, keptParties)
    deleteAbsentPeople(userId, personIdByKey.values.toSet())
    return gridFor(userId)
}

/** Inserts, renames and re-tiers the columns, and answers with the id each submitted key means. */
private fun writePeople(
    userId: String,
    people: List<GridPersonRequest>,
    now: Instant,
): Map<String, Uuid> {
    val byKey = mutableMapOf<String, Uuid>()
    for (person in people) {
        val name = person.name.trim()
        val existing = person.id?.let(Uuid::parseOrNull)
        if (existing == null) {
            val id = Uuid.random()
            Person.insert {
                it[Person.id] = id
                it[Person.userId] = userId
                it[Person.name] = name
                it[mvp] = person.mvp
                it[createdAt] = now
                it[updatedAt] = now
            }
            byKey[person.key] = id
        } else {
            Person.update({ (Person.id eq existing) and (Person.userId eq userId) }) {
                it[Person.name] = name
                it[mvp] = person.mvp
                it[updatedAt] = now
            }
            byKey[person.key] = existing
        }
    }
    return byKey
}

private fun deleteAbsentParties(
    userId: String,
    kept: List<Uuid>,
) {
    val doomed =
        Party
            .selectAll()
            .where { Party.userId eq userId }
            .map { it[Party.id] }
            .filterNot { it in kept }
    doomed.forEach { deleteParty(it, userId) }
}

private fun deleteAbsentPeople(
    userId: String,
    kept: Set<Uuid>,
) {
    val doomed =
        Person
            .selectAll()
            .where { Person.userId eq userId }
            .map { it[Person.id] }
            .filterNot { it in kept }
    if (doomed.isEmpty()) return
    Person.deleteWhere { Person.id inList doomed }
}

/**
 * Per party, the people whose SEAT in it the loot history points at, as a seller or as somebody owed.
 *
 * Per party rather than per account, because the thing that must not disappear is the seat, not the
 * column: a payout row points at one seat, and emptying that cell would delete it (and with it the
 * record that the person was paid) while the money stays real. Removing the person from the grid
 * entirely takes every seat with them, so this covers that too.
 */
internal fun seatPeopleWithLootHistory(userId: String): Map<Uuid, Set<Uuid>> {
    val parties =
        Party
            .selectAll()
            .where { Party.userId eq userId }
            .map { it[Party.id] }
    if (parties.isEmpty()) return emptyMap()

    val byParty = mutableMapOf<Uuid, Set<Uuid>>()
    for (partyId in parties) {
        val seatIds = seatsWithLootHistory(partyId)
        if (seatIds.isEmpty()) continue
        val people =
            PartyMember
                .selectAll()
                .where { PartyMember.id inList seatIds.toList() }
                .map { it[PartyMember.personId] }
                .toSet()
        if (people.isNotEmpty()) byParty[partyId] = people
    }
    return byParty
}

/** Parties that hold loot. Deleting one takes its pool with it, so the grid refuses instead. */
internal fun partiesWithLoot(userId: String): Set<Uuid> {
    val parties =
        Party
            .selectAll()
            .where { Party.userId eq userId }
            .map { it[Party.id] }
    if (parties.isEmpty()) return emptySet()
    return PartyLoot
        .selectAll()
        .where { PartyLoot.partyId inList parties }
        .map { it[PartyLoot.partyId] }
        .toSet()
}
