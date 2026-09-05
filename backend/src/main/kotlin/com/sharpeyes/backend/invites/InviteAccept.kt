package com.sharpeyes.backend.invites

import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyMember
import com.sharpeyes.backend.db.Person
import com.sharpeyes.backend.db.PersonCharacter
import com.sharpeyes.backend.db.Users
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.isNull
import org.jetbrains.exposed.v1.core.lowerCase
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.update
import kotlin.time.Instant
import kotlin.uuid.Uuid

// Turns a frozen payload into rows on the accepting account, and links the two accounts while both
// are in reach. Everything here runs in the caller's transaction: an account half-built from a link
// is worse than one that was never built, because the guard below would then refuse to try again.

/**
 * True when nothing has been entered on this account yet.
 *
 * The gate on accepting a link. Merging into an account that already has characters, people or
 * configs means deciding whether the CreedBratton in the payload is the CreedBratton already there,
 * and every wrong answer is a duplicate person or a second config for one boss that nothing on
 * screen distinguishes from the real one. Refusing is the answer that cannot be quietly wrong.
 *
 * Must be called from inside a `transaction { }` block.
 */
internal fun accountIsEmpty(userId: String): Boolean =
    Characters.selectAll().where { Characters.userId eq userId }.empty() &&
        Person.selectAll().where { Person.userId eq userId }.empty() &&
        Party.selectAll().where { Party.userId eq userId }.empty()

/**
 * Writes [payload] onto [userId]'s account.
 *
 * Assumes the account is empty (see [accountIsEmpty]) and that the payload's version has been
 * checked. Returns what it created, including the configs it could not, which the caller shows.
 *
 * Must be called from inside a `transaction { }` block.
 */
internal fun acceptInvite(
    payload: InvitePayload,
    userId: String,
    invitePersonId: Uuid,
    now: Instant,
): AcceptedInvite {
    Users.update({ Users.id eq userId }) { it[worldType] = payload.worldType }

    val characterIds = createCharacters(payload, userId, now)
    createPeople(payload, userId, now)
    val seated = takeSeats(payload, characterIds)

    linkAccounts(payload, userId, invitePersonId, now)

    return AcceptedInvite(
        charactersCreated = characterIds.size,
        peopleCreated = payload.people.size,
        partiesCreated = seated,
        omitted = payload.omitted,
    )
}

/**
 * The recipient's own characters, in the order the sender listed them.
 *
 * The sprite is copied and `sprite_checked_at` left null, so the daily refresh treats each one as
 * never asked and looks it up properly. The copy is what the roster draws in the meantime: the
 * cache is content-addressed on the URL, so these bytes are already warm and the alternative is a
 * new account whose every seat is blank until a job runs.
 */
private fun createCharacters(
    payload: InvitePayload,
    userId: String,
    now: Instant,
): Map<String, Uuid> =
    payload.characters
        .mapIndexed { index, character ->
            val id = Uuid.random()
            val sprite = payload.sprites[character.name]
            Characters.insert {
                it[Characters.id] = id
                it[Characters.userId] = userId
                it[name] = character.name
                it[worldType] = character.worldType
                it[spriteImgUrl] = sprite
                it[spriteRefreshedAt] = if (sprite != null) now else null
                it[createdAt] = now
                it[updatedAt] = now
                it[position] = index
            }
            character.name.lowercase() to id
        }.toMap()

private fun createPeople(
    payload: InvitePayload,
    userId: String,
    now: Instant,
) {
    for (person in payload.people) {
        val personId = Uuid.random()
        Person.insert {
            it[Person.id] = personId
            it[Person.userId] = userId
            it[name] = person.name
            it[createdAt] = now
            it[updatedAt] = now
        }
        person.characters.forEach { character ->
            PersonCharacter.insert {
                it[PersonCharacter.id] = Uuid.random()
                it[PersonCharacter.personId] = personId
                it[PersonCharacter.userId] = userId
                it[name] = character
            }
        }
    }
}

/**
 * The recipient's seats in the sender's configs, bound to the characters just written.
 *
 * This is what accepting an invite DOES to the parties now, and it writes nothing new: the config
 * already has a seat with this character's name on it, because that is what made the payload
 * include it. Binding it says the seat is that account's character, which is the whole of their
 * membership. Returns how many configs they are now seated in.
 *
 * It used to copy each config onto the recipient's account and pair the two with party.group_id.
 * Two rows describing one party is two pools for one night, and worse, two `difficulty` columns
 * that can disagree about a mode the piece counts are joined on (V69, and #548 is what that costs).
 * So there is one row, and it stays the sender's. See V75.
 *
 * The sender's rows are written from the recipient's transaction, which is the sender's own doing:
 * issuing the link is what says these seats are this person's.
 */
private fun takeSeats(
    payload: InvitePayload,
    characterIds: Map<String, Uuid>,
): Int {
    var seated = 0
    for (party in payload.parties) {
        // Only a config the sender still owns. One deleted since the link was made leaves nothing
        // to sit in, which is what an expired invitation looks like anyway.
        val sourceId = Uuid.parseOrNull(party.sourcePartyId)
        val owned =
            sourceId != null &&
                Party
                    .selectAll()
                    .where { (Party.id eq sourceId) and (Party.userId eq payload.senderUserId) }
                    .empty()
                    .not()
        if (owned && bindSeats(sourceId, party.members + party.ownName, characterIds)) seated++
    }
    return seated
}

/**
 * Binds the seats of [sourceId] that name one of [characterIds], and says whether any did.
 *
 * Never a seat the config's owner already holds a character for: characterId is theirs, and V75
 * states in SQL that a seat cannot be both.
 */
private fun bindSeats(
    sourceId: Uuid,
    names: List<String>,
    characterIds: Map<String, Uuid>,
): Boolean {
    var bound = false
    for (name in names) {
        val characterId = characterIds[name.lowercase()]
        if (characterId != null) {
            val changed =
                PartyMember.update({
                    (PartyMember.partyId eq sourceId) and
                        (PartyMember.name.lowerCase() eq name.lowercase()) and
                        PartyMember.characterId.isNull()
                }) { it[linkedCharacterId] = characterId }
            if (changed > 0) bound = true
        }
    }
    return bound
}

/**
 * Records that these two accounts are two people, from both sides.
 *
 * Written here and nowhere else. This is the one moment both accounts are known at once: afterwards
 * the sender's Bro and Bro's account are joined only by character names, which cannot tell a shared
 * party from two people who happen to know the same name.
 */
private fun linkAccounts(
    payload: InvitePayload,
    userId: String,
    invitePersonId: Uuid,
    now: Instant,
) {
    Person.update({ Person.id eq invitePersonId }) {
        it[linkedUserId] = userId
        it[updatedAt] = now
    }
    val senderName = payload.people.firstOrNull { it.isSender }?.name ?: return
    Person.update({ (Person.userId eq userId) and (Person.name eq senderName) }) {
        it[linkedUserId] = payload.senderUserId
        it[updatedAt] = now
    }
}
