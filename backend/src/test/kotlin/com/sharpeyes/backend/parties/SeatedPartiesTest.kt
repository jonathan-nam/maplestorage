package com.sharpeyes.backend.parties

import com.sharpeyes.backend.config.Env
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyMember
import com.sharpeyes.backend.db.Person
import com.sharpeyes.backend.users.WORLD_INTERACTIVE
import com.sharpeyes.backend.users.ensureUser
import com.sharpeyes.backend.users.setActiveWorld
import org.flywaydb.core.Flyway
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.jdbc.Database
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import org.jetbrains.exposed.v1.jdbc.update
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.time.Clock
import kotlin.uuid.Uuid

/**
 * Reaching a party you do not own, and being unable to reach one you have no seat in.
 *
 * A shared party is ONE row, the owner's, and being in it is having a seat in it (V75). That makes
 * the roster the authorisation rule, which is the whole of what this file is here to hold: every
 * other party read in the app is filtered by `Party.userId eq userId`, and that filter is what
 * keeps two accounts apart. This is the one place it does not apply, so the test that matters most
 * is the negative one.
 */
class SeatedPartiesTest {
    private val owner = "user_test_seated_owner"
    private val member = "user_test_seated_member"
    private val stranger = "user_test_seated_stranger"
    private val everyone = listOf(owner, member, stranger)

    @BeforeTest
    fun migrate() {
        val jdbcUrl = "jdbc:postgresql://${Env.dbHost}:${Env.dbPort}/${Env.dbName}"
        Flyway
            .configure()
            .dataSource(jdbcUrl, Env.dbUsername, Env.dbPassword)
            .load()
            .migrate()
        Database.connect(
            url = jdbcUrl,
            driver = "org.postgresql.Driver",
            user = Env.dbUsername,
            password = Env.dbPassword,
        )
    }

    @AfterTest
    fun cleanUp() {
        val owners = everyone
        transaction {
            Party.deleteWhere { Party.userId inList owners }
            Person.deleteWhere { Person.userId inList owners }
            Characters.deleteWhere { Characters.userId inList owners }
        }
    }

    private fun character(
        userId: String,
        name: String,
        position: Int = 0,
    ): Uuid {
        ensureUser(userId, "$userId@example.com")
        setActiveWorld(userId, WORLD_INTERACTIVE)
        val id = Uuid.random()
        val now = Clock.System.now()
        Characters.insert {
            it[Characters.id] = id
            it[Characters.userId] = userId
            it[Characters.name] = name
            it[Characters.worldType] = WORLD_INTERACTIVE
            it[createdAt] = now
            it[updatedAt] = now
            it[Characters.position] = position
        }
        return id
    }

    /** A person on [of]'s list, signing in as [account]. What accepting an invite writes. */
    private fun link(
        of: String,
        name: String,
        account: String,
    ) {
        savePeople(of, SavePeopleRequest(listOf(PersonRequest(null, name, emptyList()))), Clock.System.now())
        val id = Person.selectAll().where { Person.userId eq of }.single()[Person.id]
        Person.update({ Person.id eq id }) { it[linkedUserId] = account }
    }

    /** The owner's config, seating [members] beside their own character. */
    private fun config(
        ownCharacter: Uuid,
        members: List<String>,
    ): PartyResponse {
        val request = SavePartyRequest(ownCharacter.toString(), "kalos-the-guardian", members)
        val id = createParty(owner, ownCharacter, bossIdForKey("kalos-the-guardian")!!, request, Clock.System.now())
        return findParty(id, owner)!!
    }

    @Test
    fun `a character with a seat in somebody else's party reaches it`() {
        transaction {
            val theirs = character(owner, "mechyfechy")
            character(member, "CreedBratton")
            link(owner, "Chris", member)
            val party = config(theirs, listOf("CreedBratton"))

            val seated = partiesSeatedIn(member)
            assertEquals(listOf(party.id), seated.map { it.id })
            // The whole roster, as the owner arranged it, and which seat is mine.
            assertEquals(listOf("mechyfechy", "CreedBratton"), seated.single().seats.map { it.name })
            assertEquals(listOf(party.members[1].id), seated.single().mySeatIds)
        }
    }

    @Test
    fun `a party I have no seat in stays invisible`() {
        transaction {
            val theirs = character(owner, "mechyfechy")
            character(member, "CreedBratton")
            character(stranger, "Nosy")
            link(owner, "Chris", member)
            config(theirs, listOf("CreedBratton"))

            // The one that matters. Every other party read in the app is filtered by ownership, and
            // this is the read that is not, so a stranger reaching it would reach everything.
            assertEquals(emptyList(), partiesSeatedIn(stranger))
        }
    }

    @Test
    fun `a seat that only NAMES my character is not a seat in it`() {
        transaction {
            val theirs = character(owner, "mechyfechy")
            character(member, "CreedBratton")
            // No link, so nothing bound the seat. The owner typed a name that happens to be a real
            // character of somebody's, which is not the same as that person being in the party, and
            // is exactly how a name match would hand an account to a stranger who picked the name.
            config(theirs, listOf("CreedBratton"))

            assertEquals(emptyList(), partiesSeatedIn(member))
        }
    }

    @Test
    fun `my own parties are not in it`() {
        transaction {
            val theirs = character(owner, "mechyfechy")
            character(member, "CreedBratton")
            link(owner, "Chris", member)
            config(theirs, listOf("CreedBratton"))

            // The owner is seated in their own config, which partiesFor already answers for. Two
            // answers to one party is what the mirror used to be.
            assertEquals(emptyList(), partiesSeatedIn(owner))
        }
    }

    @Test
    fun `a seat retired out of the roster is a party I have left`() {
        transaction {
            val theirs = character(owner, "mechyfechy")
            character(member, "CreedBratton")
            link(owner, "Chris", member)
            val party = config(theirs, listOf("CreedBratton"))
            assertTrue(partiesSeatedIn(member).isNotEmpty())

            PartyMember.update({ PartyMember.id eq Uuid.parse(party.members[1].id) }) {
                it[standing] = false
            }
            assertEquals(emptyList(), partiesSeatedIn(member))
        }
    }

    @Test
    fun `the seat carries the binding, and never as one of the owner's own`() {
        transaction {
            val theirs = character(owner, "mechyfechy")
            val mine = character(member, "CreedBratton")
            link(owner, "Chris", member)
            val party = config(theirs, listOf("CreedBratton"))

            val seat = party.members[1]
            assertEquals(mine.toString(), seat.linkedCharacterId)
            // characterId stays the owner's alone. V75 says so as a CHECK, and the coupon ledger
            // reads a non-null value as SELF.
            assertEquals(null, seat.characterId)
        }
    }
}
