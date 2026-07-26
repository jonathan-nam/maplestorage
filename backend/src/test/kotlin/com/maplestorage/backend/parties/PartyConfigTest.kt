package com.maplestorage.backend.parties

import com.maplestorage.backend.config.Env
import com.maplestorage.backend.db.Characters
import com.maplestorage.backend.db.Party
import com.maplestorage.backend.db.Person
import com.maplestorage.backend.users.ensureUser
import org.flywaydb.core.Flyway
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.or
import org.jetbrains.exposed.v1.jdbc.Database
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.time.Clock
import kotlin.uuid.Uuid

/**
 * Party configs, against a real Postgres.
 *
 * A config is one of your characters, on one boss, with the people that character runs it with:
 * "mechyfechy runs Kalos with CreedBratton". The claims worth a database to check are the ones
 * about identity, since getting them wrong is invisible: that your own character is stored as a
 * seat (a loot payout points at seats, and you are usually the seller), that a seat survives the
 * roster being reordered, that a person is attached to a CHARACTER rather than to a seat, and that
 * one character cannot have two configs for the same boss.
 */
class PartyConfigTest {
    private val userOneId = "user_test_config_1"
    private val userTwoId = "user_test_config_2"

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
        transaction {
            Party.deleteWhere { (Party.userId eq userOneId) or (Party.userId eq userTwoId) }
            Person.deleteWhere { (Person.userId eq userOneId) or (Person.userId eq userTwoId) }
            Characters.deleteWhere { (Characters.userId eq userOneId) or (Characters.userId eq userTwoId) }
        }
    }

    private fun addCharacter(
        userId: String,
        name: String,
        sprite: String? = null,
    ): Uuid {
        ensureUser(userId, "$userId@example.com")
        val id = Uuid.random()
        val now = Clock.System.now()
        Characters.insert {
            it[Characters.id] = id
            it[Characters.userId] = userId
            it[Characters.name] = name
            it[spriteImgUrl] = sprite
            it[createdAt] = now
            it[updatedAt] = now
            it[position] = 0
        }
        return id
    }

    private fun config(
        userId: String,
        characterId: Uuid,
        bossKey: String,
        members: List<String>,
        name: String? = null,
        sprites: Map<String, String?> = emptyMap(),
    ): PartyResponse {
        val request = SavePartyRequest(characterId.toString(), bossKey, name, members)
        val id = createParty(userId, characterId, bossIdForKey(bossKey)!!, request, Clock.System.now(), sprites)
        return findParty(id, userId)!!
    }

    @Test
    fun `a config is your character on one boss, and stores you as the first seat`() {
        transaction {
            val mine = addCharacter(userOneId, "mechyfechy", sprite = "https://nexon.example/mech.png")
            val party = config(userOneId, mine, "kalos-the-guardian", listOf("CreedBratton"))

            assertEquals("kalos-the-guardian", party.bossKey)
            assertEquals(mine.toString(), party.characterId)
            // You first, then the people you run it with. You are a seat because a loot payout
            // points at seats and you are usually the one who sold the drop.
            assertEquals(listOf("mechyfechy", "CreedBratton"), party.members.map { it.name })
            assertEquals(mine.toString(), party.members[0].characterId)
            assertEquals("https://nexon.example/mech.png", party.members[0].spriteImgUrl)
            assertNull(party.members[1].characterId)
        }
    }

    @Test
    fun `whose character a member is comes from the people list, by name`() {
        transaction {
            val mine = addCharacter(userOneId, "mechyfechy")
            savePeople(
                userOneId,
                SavePeopleRequest(listOf(PersonRequest(name = "Chris", characters = listOf("CreedBratton")))),
                Clock.System.now(),
            )
            val kalos = config(userOneId, mine, "kalos-the-guardian", listOf("CreedBratton"))
            val baldrix = config(userOneId, mine, "baldrix", listOf("CreedBratton"))

            // Said once, shown everywhere that character appears. Storing the person on the seat
            // would mean saying it again per config, and the copies would drift.
            assertEquals("Chris", kalos.members[1].personName)
            assertEquals("Chris", baldrix.members[1].personName)
            assertEquals(kalos.members[1].personId, baldrix.members[1].personId)
        }
    }

    @Test
    fun `a seat survives the roster being reordered, so a payout still points at somebody`() {
        transaction {
            val mine = addCharacter(userOneId, "warrior2020")
            val party = config(userOneId, mine, "malefic-star", listOf("Lynn", "Kaiser"))
            val lynn = party.members.first { it.name == "Lynn" }

            val request = SavePartyRequest(mine.toString(), "malefic-star", "trio", listOf("Kaiser", "Lynn"))
            saveParty(userOneId, Uuid.parse(party.id), request, Clock.System.now())

            val saved = findParty(Uuid.parse(party.id), userOneId)!!
            assertEquals(listOf("warrior2020", "Kaiser", "Lynn"), saved.members.map { it.name })
            assertEquals(lynn.id, saved.members.first { it.name == "Lynn" }.id)
            assertEquals("trio", saved.name)
        }
    }

    @Test
    fun `refuses a config that cannot be created as asked`() {
        transaction {
            val mine = addCharacter(userOneId, "mechyfechy")
            val theirs = addCharacter(userTwoId, "SomebodyElse")
            val kalos = bossIdForKey("kalos-the-guardian")

            fun check(
                characterId: Uuid?,
                bossKey: String,
                members: List<String>,
            ) = validateNewParty(
                SavePartyRequest(characterId?.toString() ?: "", bossKey, null, members),
                userOneId,
                characterId,
                bossIdForKey(bossKey),
            )

            assertEquals(
                "characterId must be one of your characters",
                check(theirs, "kalos-the-guardian", listOf("X")),
            )
            // Zakum is in catalog/bosses.yaml but untracked, so it is seeded into no table.
            assertEquals("unknown bossKey", check(mine, "zakum", listOf("X")))
            // A boss your character solos has no config at all, which is why solo runs never show.
            assertEquals("a party needs somebody else in it", check(mine, "kalos-the-guardian", emptyList()))
            assertEquals(
                "a party holds at most 6 including your character",
                check(mine, "kalos-the-guardian", (1..6).map { "M$it" }),
            )
            assertEquals(
                "the same character twice",
                check(mine, "kalos-the-guardian", listOf("Lynn", "lynn")),
            )
            assertNull(check(mine, "kalos-the-guardian", listOf("CreedBratton")))

            // And a second config for the same character and boss is two answers to one question.
            config(userOneId, mine, "kalos-the-guardian", listOf("CreedBratton"))
            assertEquals(
                "that character already has a party for this boss",
                validateNewParty(
                    SavePartyRequest(mine.toString(), "kalos-the-guardian", null, listOf("Other")),
                    userOneId,
                    mine,
                    kalos,
                ),
            )
        }
    }

    @Test
    fun `two of your characters can run the same boss with different people`() {
        transaction {
            val mech = addCharacter(userOneId, "mechyfechy")
            val warrior = addCharacter(userOneId, "warrior2020")
            config(userOneId, mech, "limbo", listOf("CreedBratton"))
            config(userOneId, warrior, "limbo", listOf("Lynn", "Kaiser"))

            // Five "Limbo carry" rows in a hand-kept sheet are five characters of yours running
            // Limbo, not five configs for one of them.
            val parties = partiesFor(userOneId).filter { it.bossKey == "limbo" }
            assertEquals(2, parties.size)
            assertEquals(setOf(mech.toString(), warrior.toString()), parties.map { it.characterId }.toSet())
        }
    }

    @Test
    fun `refuses a people list that claims one character for two people`() {
        transaction {
            ensureUser(userOneId, "$userOneId@example.com")
            val clash =
                SavePeopleRequest(
                    listOf(
                        PersonRequest(name = "Chris", characters = listOf("CreedBratton")),
                        PersonRequest(name = "Jared", characters = listOf("creedbratton")),
                    ),
                )
            // Character names are unique in a world, so two owners is a mistake, and letting it
            // through makes "whose is this?" a question with two answers.
            assertEquals("two people claim the same character", validatePeople(clash))
            assertEquals(
                "two people share a name",
                validatePeople(SavePeopleRequest(listOf(PersonRequest(name = "Chris"), PersonRequest(name = "chris")))),
            )
        }
    }

    @Test
    fun `removing a person leaves the configs that named their characters alone`() {
        transaction {
            val mine = addCharacter(userOneId, "mechyfechy")
            savePeople(
                userOneId,
                SavePeopleRequest(listOf(PersonRequest(name = "Chris", characters = listOf("CreedBratton")))),
                Clock.System.now(),
            )
            val party = config(userOneId, mine, "baldrix", listOf("CreedBratton"))
            assertEquals("Chris", party.members[1].personName)

            savePeople(userOneId, SavePeopleRequest(emptyList()), Clock.System.now())

            val after = findParty(Uuid.parse(party.id), userOneId)!!
            // The seat is untouched: the people list says whose a character is, and taking that
            // back is not the same as saying the character was not there.
            assertEquals("CreedBratton", after.members[1].name)
            assertNull(after.members[1].personName)
            assertTrue(peopleFor(userOneId).isEmpty())
        }
    }

    @Test
    fun `another account's configs are neither listed nor readable`() {
        transaction {
            val theirs = addCharacter(userTwoId, "TheirGuy")
            val party = config(userTwoId, theirs, "limbo", listOf("Someone"))
            ensureUser(userOneId, "$userOneId@example.com")

            assertTrue(partiesFor(userOneId).isEmpty())
            assertNull(findParty(Uuid.parse(party.id), userOneId))
            assertTrue(!ownsParty(Uuid.parse(party.id), userOneId))
            assertTrue(!deleteParty(Uuid.parse(party.id), userOneId))
        }
    }
}
