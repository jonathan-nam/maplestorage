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
    val owned: Map<Uuid, List<String>>,
) {
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
private fun ownedByLinkedAccounts(userId: String): Map<Uuid, List<String>> {
    val personByAccount =
        Person
            .selectAll()
            .where { (Person.userId eq userId) and Person.linkedUserId.isNotNull() }
            .mapNotNull { row -> row[Person.linkedUserId]?.let { it to row[Person.id] } }
            .toMap()
    if (personByAccount.isEmpty()) return emptyMap()

    val seated =
        PartyMember
            .innerJoin(Party)
            .selectAll()
            .where { Party.userId eq userId }
            .mapTo(mutableSetOf()) { it[PartyMember.name].lowercase() }

    return if (seated.isEmpty()) {
        emptyMap()
    } else {
        Characters
            .selectAll()
            .where {
                (Characters.userId inList personByAccount.keys.toList()) and inActiveWorld(userId)
            }.mapNotNull { row ->
                val personId = personByAccount[row[Characters.userId]] ?: return@mapNotNull null
                val name = row[Characters.name]
                if (name.lowercase() in seated) personId to name else null
            }.groupBy({ it.first }) { it.second }
            .mapValues { (_, names) -> names.sorted() }
    }
}
