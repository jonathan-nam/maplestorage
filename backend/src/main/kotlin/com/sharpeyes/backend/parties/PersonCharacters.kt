package com.sharpeyes.backend.parties

import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyMember
import com.sharpeyes.backend.db.Person
import com.sharpeyes.backend.db.PersonCharacter
import com.sharpeyes.backend.users.inActiveWorld
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.core.isNotNull
import org.jetbrains.exposed.v1.jdbc.selectAll
import kotlin.uuid.Uuid

// Whose character a character is. Its own file rather than another few functions in PartyQueries,
// because both of that file's people reads go through it and neither owns it.
// Must be called from inside a `transaction { }` block.

/**
 * The characters each of this account's people plays, and how each of them came to be known.
 *
 * Two sources, and they are not equal. `attributed` is person_character: what the account owner
 * SAID, one name at a time on the People page. `owned` is what a person's own account holds, once
 * they have accepted an invite and person.linked_user_id names them (V70). That is not something
 * you said about them, it is something they did, so it is not yours to edit and it wins wherever
 * the two disagree. Evidence over assumption, the order CharacterRoutes already keeps between a
 * Nexon lookup and the world you happen to be looking at.
 *
 * Both readers go through this rather than querying person_character themselves, or the People
 * page and the seat under it could name different people for the same character.
 */
internal class PersonCharacters(
    val attributed: Map<Uuid, List<String>>,
    linkedCharacters: List<LinkedCharacter>,
) {
    /** Their own account's answer, by person. What the People page draws as not yours to edit. */
    val owned: Map<Uuid, List<String>> =
        linkedCharacters
            .groupBy({ it.personId }) { it.name }
            .mapValues { (_, names) -> names.sorted() }

    /** Lowercased character name to whoever plays them. */
    fun byCharacter(): Map<String, Uuid> =
        buildMap {
            for ((personId, names) in attributed) {
                for (name in names) put(name.lowercase(), personId)
            }
            // Second, so it overwrites what was attributed. See the note on precedence above.
            for ((personId, names) in owned) {
                for (name in names) put(name.lowercase(), personId)
            }
        }
}

/**
 * One character on a linked person's own account, which a seat of this account's names.
 *
 * Deliberately NOT written onto party_member.character_id. That column means "this seat is one of
 * MY characters" and four readers depend on it saying so, one of them the coupon ledger, which
 * returns SELF on a non-null value. Pointing it at somebody else's character would report their
 * pieces as yours, silently, which is the failure this repo exists to prevent.
 */
internal data class LinkedCharacter(
    val characterId: Uuid,
    val personId: Uuid,
    val name: String,
    val spriteImgUrl: String?,
)

internal fun personCharacters(userId: String): PersonCharacters {
    val attributed =
        PersonCharacter
            .selectAll()
            .where { PersonCharacter.userId eq userId }
            .orderBy(PersonCharacter.name)
            .groupBy({ it[PersonCharacter.personId] }) { it[PersonCharacter.name] }
    return PersonCharacters(attributed, ownedByLinkedAccounts(userId))
}

/**
 * The characters a linked person's own account holds, of the ones this account already seats.
 *
 * Only the seated ones. Their roster is theirs: a person with forty mules is not forty rows in
 * your ledger, and the only question this answers is whose seat a seat is, which a character you
 * have never run with is not an answer to. It also means linking someone shows you nothing about
 * their account you had not already typed in yourself.
 *
 * Narrowed to the world being shown, like every other account-wide read. A party is in one world,
 * so the other world's characters cannot be the seat in front of you.
 */
private fun ownedByLinkedAccounts(userId: String): List<LinkedCharacter> {
    val personByAccount =
        Person
            .selectAll()
            .where { (Person.userId eq userId) and Person.linkedUserId.isNotNull() }
            .mapNotNull { row -> row[Person.linkedUserId]?.let { it to row[Person.id] } }
            .toMap()
    if (personByAccount.isEmpty()) return emptyList()

    val seated =
        PartyMember
            .innerJoin(Party)
            .selectAll()
            .where { Party.userId eq userId }
            .mapTo(mutableSetOf()) { it[PartyMember.name].lowercase() }

    return if (seated.isEmpty()) {
        emptyList()
    } else {
        Characters
            .selectAll()
            .where {
                (Characters.userId inList personByAccount.keys.toList()) and inActiveWorld(userId)
            }.mapNotNull { row ->
                val personId = personByAccount[row[Characters.userId]] ?: return@mapNotNull null
                val name = row[Characters.name]
                if (name.lowercase() !in seated) {
                    null
                } else {
                    LinkedCharacter(
                        characterId = row[Characters.id],
                        personId = personId,
                        name = name,
                        spriteImgUrl = row[Characters.spriteImgUrl],
                    )
                }
            }
    }
}

/**
 * Every character a linked person's own account holds, by lowercased name.
 *
 * For BINDING a seat, which is a different job from attributing one, so it is a different query.
 * ownedByLinkedAccounts is narrowed to characters this account already seats, because a person's
 * roster is theirs and the People page has no business listing forty of their mules. Binding is
 * asked about a name the caller has just typed into a roster themselves, so narrowing it to what is
 * already seated would refuse to bind the very seat being written.
 *
 * Nothing this returns is ever sent anywhere. It answers "is the name in front of me a real
 * character of theirs", and the caller already knew the name.
 */
internal fun linkedCharactersFor(userId: String): Map<String, Uuid> {
    val accounts =
        Person
            .selectAll()
            .where { (Person.userId eq userId) and Person.linkedUserId.isNotNull() }
            .mapNotNull { it[Person.linkedUserId] }
    if (accounts.isEmpty()) return emptyMap()

    return Characters
        .selectAll()
        .where {
            (Characters.userId inList accounts) and inActiveWorld(userId)
        }.associate { it[Characters.name].lowercase() to it[Characters.id] }
}
