package com.maplestorage.backend.parties

import com.maplestorage.backend.config.Env
import com.maplestorage.backend.db.Characters
import com.maplestorage.backend.db.Party
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
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.time.Clock
import kotlin.uuid.Uuid

/**
 * The party roster, against a real Postgres.
 *
 * The things only a database answers are the ones tested here: that a save UPDATES the seats it
 * was given ids for rather than re-creating them (loot payouts point at those rows), that the
 * ownership filter really excludes another account's parties, and that a boss key the catalog does
 * not have is refused rather than written short.
 */
class PartiesTest {
    private val userOneId = "user_test_parties_1"
    private val userTwoId = "user_test_parties_2"

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
            // party_member and party_boss cascade from party; characters go last because a seat
            // references them.
            Party.deleteWhere { (Party.userId eq userOneId) or (Party.userId eq userTwoId) }
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

    private fun seats(vararg names: String) = names.map { PartyMemberRequest(name = it) }

    // party.user_id is a real FK, so the user has to exist before the party does.
    private fun save(
        userId: String,
        request: SavePartyRequest,
    ): PartyResponse {
        ensureUser(userId, "$userId@example.com")
        return createParty(userId, request, Clock.System.now())
    }

    @Test
    fun `keeps the submitted seat order and the catalog's boss order`() {
        transaction {
            val main = addCharacter(userOneId, "Rune")
            val members =
                listOf(
                    PartyMemberRequest(name = "Rune", characterId = main.toString()),
                    PartyMemberRequest(name = "Steve", mvp = true),
                )
            // Submitted out of progression order on purpose.
            val bosses = listOf("kalos-the-guardian", "baldrix", "first-adversary")
            val party = save(userOneId, SavePartyRequest("Duo", members, bosses))

            assertEquals(listOf("Rune", "Steve"), party.members.map { it.name })
            assertEquals(main.toString(), party.members[0].characterId)
            assertNull(party.members[1].characterId)
            assertTrue(party.members[1].mvp)
            // catalog/bosses.yaml order, not the order they were sent in: the matrix and the party
            // card have to agree on what "first" means.
            assertEquals(listOf("kalos-the-guardian", "first-adversary", "baldrix"), party.bossKeys)
        }
    }

    @Test
    fun `a save updates the seats it was given ids for and deletes the rest`() {
        transaction {
            val party = save(userOneId, SavePartyRequest(null, seats("Steve", "Bob"), listOf("limbo")))
            val steve = party.members.first { it.name == "Steve" }
            val partyId = Uuid.parse(party.id)

            // Steve is kept by id, renamed and promoted to MVP. Bob is absent, so his seat goes.
            val edited =
                listOf(
                    PartyMemberRequest(id = steve.id, name = "Steven", mvp = true),
                    PartyMemberRequest(name = "Cara"),
                )
            val request = SavePartyRequest("Limbo trio", edited, listOf("limbo", "kaling"))
            saveParty(partyId, userOneId, request, Clock.System.now())

            val saved = findParty(partyId, userOneId)!!
            assertEquals("Limbo trio", saved.name)
            assertEquals(listOf("Steven", "Cara"), saved.members.map { it.name })
            // The id survived the edit. A payout row pointing at this seat still points at Steve.
            assertEquals(steve.id, saved.members[0].id)
            assertTrue(saved.members[0].mvp)
            assertEquals(listOf("kaling", "limbo"), saved.bossKeys)
        }
    }

    @Test
    fun `another account's parties are neither listed nor readable by id`() {
        transaction {
            val theirs = save(userTwoId, SavePartyRequest(members = seats("Steve")))
            val theirId = Uuid.parse(theirs.id)
            ensureUser(userOneId, "$userOneId@example.com")

            assertTrue(partiesFor(userOneId).isEmpty())
            assertNull(findParty(theirId, userOneId))
            assertTrue(!ownsParty(theirId, userOneId))
            // A delete that reached another account's row would answer 204 as if it had worked.
            assertTrue(!deleteParty(theirId, userOneId))
            assertNotNull(findParty(theirId, userTwoId))
        }
    }

    @Test
    fun `refuses a party that cannot be saved as asked`() {
        transaction {
            val mine = addCharacter(userOneId, "Rune")
            val theirs = addCharacter(userTwoId, "Someone")
            val owned = setOf(mine)

            fun check(
                members: List<PartyMemberRequest>,
                bosses: List<String> = emptyList(),
            ) = validateParty(SavePartyRequest(null, members, bosses), owned, emptySet())

            val sevenSeats = (1..7).map { PartyMemberRequest(name = "M$it") }
            val mySeat = PartyMemberRequest(name = "Rune", characterId = mine.toString())
            val theirSeat = PartyMemberRequest(name = "Someone", characterId = theirs.toString())

            assertEquals("a party needs at least one member", check(emptyList()))
            assertEquals("a party holds at most 6 members", check(sevenSeats))
            assertEquals("member names must not be blank", check(seats("  ")))
            assertEquals("characterId must be one of your characters", check(listOf(theirSeat)))
            assertEquals(
                "a character can hold only one seat in a party",
                check(listOf(mySeat, mySeat.copy(name = "Rune again"))),
            )
            // Zakum is in catalog/bosses.yaml but untracked, so it is seeded into no table. A party
            // covering it would cover a boss nothing else in the app knows about.
            assertEquals("unknown boss key", check(seats("Steve"), listOf("baldrix", "zakum")))
            assertNull(check(listOf(mySeat), listOf("baldrix")))
        }
    }

    @Test
    fun `a seat of yours shows the character's sprite, and other seats show what was looked up`() {
        transaction {
            val main = addCharacter(userOneId, "Rune", sprite = "https://nexon.example/rune.png")
            val members =
                listOf(
                    PartyMemberRequest(name = "Rune", characterId = main.toString()),
                    PartyMemberRequest(name = "Steve"),
                    PartyMemberRequest(name = "Ghost"),
                )
            // Steve resolved, Ghost did not. Both were asked, which is what the null records.
            val sprites = mapOf("Steve" to "https://nexon.example/steve.png", "Ghost" to null)
            val party =
                createParty(userOneId, SavePartyRequest("Trio", members, emptyList()), Clock.System.now(), sprites)

            // Read off the character, not copied onto the seat: refreshing the character's sprite
            // has to move the party's portrait with it.
            assertEquals("https://nexon.example/rune.png", party.members[0].spriteImgUrl)
            assertEquals("https://nexon.example/steve.png", party.members[1].spriteImgUrl)
            assertNull(party.members[2].spriteImgUrl)

            // A save that touches neither name must not wipe the sprites it did not look up.
            val kept =
                party.members.map {
                    PartyMemberRequest(
                        id = it.id,
                        name = it.name,
                        characterId = it.characterId,
                    )
                }
            saveParty(Uuid.parse(party.id), userOneId, SavePartyRequest("Trio", kept, emptyList()), Clock.System.now())

            val saved = findParty(Uuid.parse(party.id), userOneId)!!
            assertEquals("https://nexon.example/rune.png", saved.members[0].spriteImgUrl)
            assertEquals("https://nexon.example/steve.png", saved.members[1].spriteImgUrl)
        }
    }

    @Test
    fun `a seat id from another party is refused rather than moved`() {
        transaction {
            val one = save(userOneId, SavePartyRequest(members = seats("Steve")))
            val two = save(userOneId, SavePartyRequest(members = seats("Bob")))
            val stray = PartyMemberRequest(id = one.members[0].id, name = "Steve")

            val problem =
                validateParty(
                    SavePartyRequest(members = listOf(stray)),
                    emptySet(),
                    memberIdsOf(Uuid.parse(two.id)),
                )
            assertEquals("unknown member id", problem)
        }
    }

    @Test
    fun `deleting a party takes its seats and boss links with it`() {
        transaction {
            val party = save(userOneId, SavePartyRequest(null, seats("Steve"), listOf("baldrix")))
            val partyId = Uuid.parse(party.id)

            assertTrue(deleteParty(partyId, userOneId))
            assertNull(findParty(partyId, userOneId))
            assertTrue(memberIdsOf(partyId).isEmpty())
        }
    }
}
