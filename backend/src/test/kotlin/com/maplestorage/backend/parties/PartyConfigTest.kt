package com.maplestorage.backend.parties

import com.maplestorage.backend.bosses.currentBossClearsFor
import com.maplestorage.backend.bosses.upsertBossClears
import com.maplestorage.backend.config.Env
import com.maplestorage.backend.db.BossCatalog
import com.maplestorage.backend.db.BossClear
import com.maplestorage.backend.db.Characters
import com.maplestorage.backend.db.Party
import com.maplestorage.backend.db.Person
import com.maplestorage.backend.db.Screenshots
import com.maplestorage.backend.services.DetectedBossClear
import com.maplestorage.backend.users.ensureUser
import org.flywaydb.core.Flyway
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.or
import org.jetbrains.exposed.v1.jdbc.Database
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.selectAll
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
            // boss_clear and screenshots reference the characters, so they go before them.
            val owned =
                Characters
                    .selectAll()
                    .where { (Characters.userId eq userOneId) or (Characters.userId eq userTwoId) }
                    .map { it[Characters.id] }
            owned.forEach { id -> BossClear.deleteWhere { characterId eq id } }
            Screenshots.deleteWhere { (Screenshots.userId eq userOneId) or (Screenshots.userId eq userTwoId) }
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
        sprites: Map<String, String?> = emptyMap(),
    ): PartyResponse {
        val request = SavePartyRequest(characterId.toString(), bossKey, members)
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

            val request = SavePartyRequest(mine.toString(), "malefic-star", listOf("Kaiser", "Lynn"))
            saveParty(userOneId, Uuid.parse(party.id), request, Clock.System.now())

            val saved = findParty(Uuid.parse(party.id), userOneId)!!
            assertEquals(listOf("warrior2020", "Kaiser", "Lynn"), saved.members.map { it.name })
            assertEquals(lynn.id, saved.members.first { it.name == "Lynn" }.id)
        }
    }

    @Test
    fun `editing a config leaves the day it was set up alone`() {
        transaction {
            val mine = addCharacter(userOneId, "mechyfechy")
            val party = config(userOneId, mine, "limbo", listOf("Lynn"))

            val swapped = SavePartyRequest(mine.toString(), "limbo", listOf("Kaiser"))
            saveParty(userOneId, Uuid.parse(party.id), swapped, Clock.System.now())
            val saved = findParty(Uuid.parse(party.id), userOneId)!!

            // Party View decides which configs a PAST week admits by comparing createdAt against
            // that week's end (see existedInWeek in frontend/lib/parties.ts). If an edit moved
            // createdAt forward, swapping a name today would evict the config from weeks it really
            // was around for, and a week that was right yesterday would quietly lose rows.
            assertEquals(party.createdAt, saved.createdAt)
            assertTrue(saved.updatedAt >= party.updatedAt)
            assertEquals(listOf("mechyfechy", "Kaiser"), saved.members.map { it.name })
        }
    }

    @Test
    fun `a config cannot be moved to another character or boss, so a past clear cannot be reattributed`() {
        transaction {
            val mine = addCharacter(userOneId, "mechyfechy")
            val other = addCharacter(userOneId, "warrior2020")
            val party = config(userOneId, mine, "limbo", listOf("Lynn"))

            // Asks for both to be changed. The character and the boss are what the config IS, and
            // boss_clear is keyed on exactly that pair, so honouring this would move every past
            // clear this config draws onto a character who never ran it.
            saveParty(
                userOneId,
                Uuid.parse(party.id),
                SavePartyRequest(other.toString(), "kalos-the-guardian", listOf("Lynn")),
                Clock.System.now(),
            )

            val saved = findParty(Uuid.parse(party.id), userOneId)!!
            assertEquals(mine.toString(), saved.characterId)
            assertEquals("limbo", saved.bossKey)
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
                SavePartyRequest(characterId?.toString() ?: "", bossKey, members),
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
                    SavePartyRequest(mine.toString(), "kalos-the-guardian", listOf("Other")),
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
    fun `a config and the clear matrix are the same row, read from both ends`() {
        transaction {
            val mine = addCharacter(userOneId, "mechyfechy")
            val party = config(userOneId, mine, "kalos-the-guardian", listOf("CreedBratton"))
            // Nobody has said anything this period, which is not the same as "not cleared".
            assertNull(party.cleared)

            val boss =
                BossCatalog
                    .selectAll()
                    .where { BossCatalog.bossKey eq "kalos-the-guardian" }
                    .first()
            setPartyClear(party, boss[BossCatalog.id], boss[BossCatalog.reset], true, Clock.System.now())

            val ticked = findParty(Uuid.parse(party.id), userOneId)!!
            assertEquals(true, ticked.cleared)
            // No screenshot behind it, so the UI can say it was ticked rather than captured.
            assertTrue(ticked.clearedByHand)

            // And the clear matrix sees the same thing, because it IS the same row. This is the
            // whole of the sync between the two pages: one answer, two readers.
            val matrix = currentBossClearsFor(userOneId, Clock.System.now())
            val clears = matrix[mine.toString()].orEmpty()
            assertEquals(listOf("kalos-the-guardian"), clears.map { it.bossKey })
            assertTrue(clears.single().cleared)

            // Un-ticking says "seen, not done" rather than removing the row: absent would mean
            // nobody had said anything, and somebody just did.
            setPartyClear(party, boss[BossCatalog.id], boss[BossCatalog.reset], false, Clock.System.now())
            assertEquals(false, findParty(Uuid.parse(party.id), userOneId)!!.cleared)
        }
    }

    @Test
    fun `a planner capture shows up in the party view without being told twice`() {
        transaction {
            val mine = addCharacter(userOneId, "mechyfechy")
            val party = config(userOneId, mine, "limbo", listOf("CreedBratton"))
            val shot = Uuid.random()
            Screenshots.insert {
                it[Screenshots.id] = shot
                it[Screenshots.userId] = userOneId
                it[characterId] = mine
                it[type] = "PLANNER"
                it[uploadedAt] = Clock.System.now()
                it[parseStatus] = "SUCCESS"
            }
            upsertBossClears(
                mine,
                listOf(DetectedBossClear("limbo", true)),
                shot,
                Clock.System.now(),
            )

            val seen = findParty(Uuid.parse(party.id), userOneId)!!
            assertEquals(true, seen.cleared)
            // Read off a planner, so not by hand: the two are not equally trustworthy and are not
            // drawn the same.
            assertTrue(!seen.clearedByHand)
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
