package com.maplestorage.backend.parties

import com.maplestorage.backend.db.Characters
import com.maplestorage.backend.db.Party
import com.maplestorage.backend.db.PartyMember
import com.maplestorage.backend.db.Person
import com.maplestorage.backend.db.PersonCharacter
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.core.notInList
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.update
import kotlin.time.Instant
import kotlin.uuid.Uuid

// Writes behind /api/parties and /api/people. Inside a transaction, on input the route has
// already validated.

internal fun createParty(
    userId: String,
    characterId: Uuid,
    bossCatalogId: Uuid,
    request: SavePartyRequest,
    now: Instant,
    // character name -> sprite the Nexon lookup found, or null when it came back empty.
    sprites: Map<String, String?> = emptyMap(),
): Uuid {
    val partyId = Uuid.random()
    Party.insert {
        it[id] = partyId
        it[Party.userId] = userId
        it[Party.characterId] = characterId
        it[Party.bossCatalogId] = bossCatalogId
        it[name] = request.name?.trim()?.ifBlank { null }
        it[createdAt] = now
        it[updatedAt] = now
    }
    writeMembers(userId, partyId, characterId, request.members, sprites, now)
    return partyId
}

/**
 * Replaces the config's label and members.
 *
 * The character and the boss are not editable: they are what the config IS, and changing either
 * would silently turn "Kalos on mechyfechy" into a different question with the same loot pool
 * hanging off it. Delete it and make the other one instead.
 *
 * Seats are matched to existing rows by character NAME, so correcting a label or reordering the
 * list keeps the row a loot payout points at.
 */
internal fun saveParty(
    userId: String,
    partyId: Uuid,
    request: SavePartyRequest,
    now: Instant,
    sprites: Map<String, String?> = emptyMap(),
) {
    val characterId =
        Party
            .selectAll()
            .where { (Party.id eq partyId) and (Party.userId eq userId) }
            .first()[Party.characterId]
    Party.update({ (Party.id eq partyId) and (Party.userId eq userId) }) {
        it[name] = request.name?.trim()?.ifBlank { null }
        it[updatedAt] = now
    }
    writeMembers(userId, partyId, characterId, request.members, sprites, now)
}

internal fun deleteParty(
    partyId: Uuid,
    userId: String,
): Boolean = Party.deleteWhere { (Party.id eq partyId) and (Party.userId eq userId) } > 0

/**
 * Writes the seats, YOUR character first.
 *
 * The API takes the others, because that is what you type: the config already knows whose it is.
 * Your character is stored as a seat anyway, and that is not bookkeeping for its own sake. A loot
 * pool's payouts point at seats, and you are usually the one who sold the drop, so leaving
 * yourself out would make the seller of most drops unnameable.
 */
private fun writeMembers(
    userId: String,
    partyId: Uuid,
    ownCharacterId: Uuid,
    members: List<String>,
    sprites: Map<String, String?>,
    now: Instant,
) {
    val ownName =
        Characters
            .selectAll()
            .where { Characters.id eq ownCharacterId }
            .first()[Characters.name]
    val names = listOf(ownName) + members.map { it.trim() }.filterNot { it.equals(ownName, ignoreCase = true) }
    val existing =
        PartyMember
            .selectAll()
            .where { PartyMember.partyId eq partyId }
            .associate { it[PartyMember.name].lowercase() to it[PartyMember.id] }

    val kept = names.mapNotNull { existing[it.lowercase()] }
    if (kept.isEmpty()) {
        PartyMember.deleteWhere { PartyMember.partyId eq partyId }
    } else {
        PartyMember.deleteWhere { (PartyMember.partyId eq partyId) and (PartyMember.id notInList kept) }
    }

    // Your own characters, by lowercased name: a seat naming one of them is linked to it, so it
    // shows the roster's sprite. Names are unique per world, so this cannot bind somebody else's.
    val mine =
        Characters
            .selectAll()
            .where { Characters.userId eq userId }
            .associate { it[Characters.name].lowercase() to it[Characters.id] }

    names.forEachIndexed { index, name ->
        val characterId = mine[name.lowercase()]
        // A seat of yours reads its sprite off the character, so no copy is kept here: a copy
        // would go stale the moment the character's own sprite is refreshed.
        val looked = characterId == null && sprites.containsKey(name)
        val seatId = existing[name.lowercase()]
        if (seatId == null) {
            PartyMember.insert {
                it[id] = Uuid.random()
                it[PartyMember.partyId] = partyId
                it[PartyMember.name] = name
                it[PartyMember.characterId] = characterId
                it[position] = index
                it[spriteImgUrl] = if (looked) sprites[name] else null
                it[spriteRefreshedAt] = if (looked) now else null
            }
        } else {
            PartyMember.update({ PartyMember.id eq seatId }) {
                it[PartyMember.name] = name
                it[PartyMember.characterId] = characterId
                it[position] = index
                // Left alone unless this character was looked up just now, or the seat became one
                // of yours. Otherwise a save that only reorders seats would wipe every sprite.
                if (characterId != null) {
                    it[spriteImgUrl] = null
                    it[spriteRefreshedAt] = null
                } else if (looked) {
                    it[spriteImgUrl] = sprites[name]
                    it[spriteRefreshedAt] = now
                }
            }
        }
    }
}

/**
 * Replaces the people list and every character attributed to them.
 *
 * Configs are untouched: they name characters, and this only says whose those characters are. So
 * removing a person leaves every seat exactly where it was, showing no owner.
 */
internal fun savePeople(
    userId: String,
    request: SavePeopleRequest,
    now: Instant,
) {
    val kept = mutableListOf<Uuid>()
    for (person in request.people) {
        val name = person.name.trim()
        val existing = person.id?.let(Uuid::parseOrNull)
        val personId =
            if (existing == null) {
                val id = Uuid.random()
                Person.insert {
                    it[Person.id] = id
                    it[Person.userId] = userId
                    it[Person.name] = name
                    it[createdAt] = now
                    it[updatedAt] = now
                }
                id
            } else {
                Person.update({ (Person.id eq existing) and (Person.userId eq userId) }) {
                    it[Person.name] = name
                    it[updatedAt] = now
                }
                existing
            }
        kept += personId

        PersonCharacter.deleteWhere { PersonCharacter.personId eq personId }
        person.characters
            .map { it.trim() }
            .filter { it.isNotEmpty() }
            .distinctBy { it.lowercase() }
            .forEach { character ->
                PersonCharacter.insert {
                    it[PersonCharacter.id] = Uuid.random()
                    it[PersonCharacter.personId] = personId
                    it[PersonCharacter.userId] = userId
                    it[PersonCharacter.name] = character
                }
            }
    }

    val doomed =
        Person
            .selectAll()
            .where { Person.userId eq userId }
            .map { it[Person.id] }
            .filterNot { it in kept }
    if (doomed.isNotEmpty()) Person.deleteWhere { Person.id inList doomed }
}
