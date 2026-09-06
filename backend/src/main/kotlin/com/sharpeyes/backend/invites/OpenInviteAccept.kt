package com.sharpeyes.backend.invites

import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyMember
import com.sharpeyes.backend.db.Person
import com.sharpeyes.backend.db.PersonCharacter
import org.jetbrains.exposed.v1.core.JoinType
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.core.isNull
import org.jetbrains.exposed.v1.core.lowerCase
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.update
import kotlin.time.Instant
import kotlin.uuid.Uuid

// An introduction between two accounts with no record of each other.
//
// V70's link is addressed to a person and carries what the sender already holds for them, which is
// exactly why it cannot reach a stranger: two people who met in a party finder have no row to name
// each other by. So this link names nobody, and the recipient supplies what the sender is missing.
// They give one character, it becomes the person the sender now has for them, and each account ends
// up with a person carrying the other's linked_user_id.
//
// One character each way is the whole of it, and it is enough because linkedCharactersFor reads a
// linked ACCOUNT's characters rather than its person_character rows: from here on every seat the
// sender types binds to their account on its own. What the rest of their roster is stays theirs to
// say. See PersonCharacters.kt and V76.

/**
 * Why this introduction cannot be made, or null.
 *
 * Asked before the link is spent, so a refusal leaves the same link working. Neither of the two
 * that matter can be asked when the link is MADE: nobody knows yet which character will be typed.
 *
 * Must be called from inside a `transaction { }` block.
 */
internal fun openInviteRefusal(
    payload: InvitePayload,
    userId: String,
    character: String?,
): String? {
    val name = character?.trim().orEmpty()
    return when {
        name.isEmpty() -> "name the character you run with them as"
        // Their own character by that name, in a world this link is not for. Names are unique
        // within a world and not across them, so the two are different characters and only one of
        // them can party with the sender. Creating a second row in the link's world is what
        // ensureCharacters would otherwise do, and it would be a character they do not have.
        inAnotherWorld(userId, name, payload.worldType) -> "$name is in your other world."
        // The sender already having this name is either the two of them not being strangers at
        // all, or somebody claiming a character that is not theirs, and nothing here can tell
        // those apart. The first has a link of its own, addressed to the person the sender already
        // holds, so refusing points at the tool for it rather than guessing between the two.
        senderKnows(payload.senderUserId, name) ->
            "${payload.senderName} already knows $name. Ask them for a link of your own."
        else -> null
    }
}

/**
 * Writes the introduction, on input [openInviteRefusal] has passed.
 *
 * Both halves in one transaction, which is what makes the two accounts point at each other or at
 * nothing: a person on the sender's side naming this character, the sender on the recipient's side,
 * and linked_user_id on both. See linkAccounts, which writes that pair for either kind of link.
 *
 * Must be called from inside a `transaction { }` block.
 */
internal fun acceptOpenInvite(
    payload: InvitePayload,
    userId: String,
    character: String,
    now: Instant,
): AcceptedInvite {
    val name = character.trim()
    adoptWorld(payload, userId)

    // An open link carries no characters, so the one they named is written into a copy of the
    // payload and taken the way every other link's are: found by name and world, else created.
    val introduced = payload.copy(characters = listOf(InviteCharacter(name, payload.worldType)))
    val characterId = ensureCharacters(introduced, userId, now).getValue(name.lowercase())

    val personId = namePerson(payload.senderUserId, name, now)
    ensurePeople(payload, userId, now)
    linkAccounts(payload, userId, personId, now)

    return AcceptedInvite(
        charactersCreated = introduced.characters.size,
        peopleCreated = payload.people.size,
        partiesCreated = bindSeatsNamed(payload.senderUserId, payload.worldType, name, characterId),
    )
}

/**
 * Whether this account has a character of that name, but not in [world].
 *
 * False for a name they have never used, which is most of them, and false when they have one in
 * [world] as well: two rows one name apart are two characters, and the one this link is for is the
 * one it can be about.
 */
private fun inAnotherWorld(
    userId: String,
    name: String,
    world: String,
): Boolean {
    val worlds =
        Characters
            .selectAll()
            .where { (Characters.userId eq userId) and (Characters.name.lowerCase() eq name.lowercase()) }
            .mapTo(mutableSetOf()) { it[Characters.worldType] }
    return worlds.isNotEmpty() && world !in worlds
}

/**
 * Whether [name] is already somebody to this account.
 *
 * Three ways to be, and all three are the same answer: their own character, a character they have
 * attributed to somebody, or a person they have named. A seat that merely holds the name is NOT one
 * of them. An unattributed seat is the ordinary state of a roster somebody has typed, and refusing
 * on one would refuse exactly the case this link is for: the people you already run with.
 */
private fun senderKnows(
    senderUserId: String,
    name: String,
): Boolean {
    val lower = name.lowercase()
    val own =
        Characters
            .selectAll()
            .where { (Characters.userId eq senderUserId) and (Characters.name.lowerCase() eq lower) }
            .empty()
            .not()
    val attributed =
        PersonCharacter
            .selectAll()
            .where { (PersonCharacter.userId eq senderUserId) and (PersonCharacter.name.lowerCase() eq lower) }
            .empty()
            .not()
    val named =
        Person
            .selectAll()
            .where { (Person.userId eq senderUserId) and (Person.name.lowerCase() eq lower) }
            .empty()
            .not()
    return own || attributed || named
}

/**
 * The person the sender now has for the recipient, named after the character they gave.
 *
 * A person is named after one of their characters everywhere else in this app (see senderNameFor),
 * and the sender has nothing else to go on. Renaming them is an ordinary edit on the people board.
 */
private fun namePerson(
    senderUserId: String,
    name: String,
    now: Instant,
): Uuid {
    val personId = Uuid.random()
    Person.insert {
        it[id] = personId
        it[userId] = senderUserId
        it[Person.name] = name
        it[createdAt] = now
        it[updatedAt] = now
    }
    PersonCharacter.insert {
        it[id] = Uuid.random()
        it[PersonCharacter.personId] = personId
        it[userId] = senderUserId
        it[PersonCharacter.name] = name
    }
    return personId
}

/**
 * The sender's seats already naming this character, bound to it, and how many.
 *
 * The common case for this link is two people who have already run together, so the sender has
 * typed the name into a roster and it has been sitting there attributed to nobody. Binding it is
 * what makes the party show up for them at once, and it is the same UPDATE bindSeats makes for a
 * person link.
 *
 * Retired seats too, deliberately. One gets them nothing while it is retired (partiesSeatedIn reads
 * standing seats only), and writeMembers does not bind an existing seat, so a member who comes back
 * to the roster would otherwise be a seat nothing ever binds again.
 *
 * Never a seat the owner holds a character for: party_member_linked_is_not_own says a seat cannot
 * be both. Never one already bound either, which would be taking somebody else's membership.
 */
private fun bindSeatsNamed(
    senderUserId: String,
    world: String,
    name: String,
    characterId: Uuid,
): Int {
    val parties =
        Party
            .join(Characters, JoinType.INNER, Party.characterId, Characters.id)
            .selectAll()
            .where { (Party.userId eq senderUserId) and (Characters.worldType eq world) }
            .map { it[Party.id] }
    if (parties.isEmpty()) return 0
    return PartyMember.update({
        (PartyMember.partyId inList parties) and
            (PartyMember.name.lowerCase() eq name.lowercase()) and
            PartyMember.characterId.isNull() and
            PartyMember.linkedCharacterId.isNull()
    }) { it[linkedCharacterId] = characterId }
}
