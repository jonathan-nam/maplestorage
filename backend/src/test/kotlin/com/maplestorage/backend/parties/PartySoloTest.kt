package com.maplestorage.backend.parties

import com.maplestorage.backend.bosses.setBossRoutine
import com.maplestorage.backend.config.Env
import com.maplestorage.backend.db.Characters
import com.maplestorage.backend.db.Party
import com.maplestorage.backend.db.Screenshots
import com.maplestorage.backend.users.WORLD_INTERACTIVE
import com.maplestorage.backend.users.ensureUser
import kotlinx.datetime.LocalDate
import org.flywaydb.core.Flyway
import org.jetbrains.exposed.v1.core.inList
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
 * The pool for a boss run alone, against a real Postgres.
 *
 * Two claims are worth a database. That a solo pool is not a party: it holds drops and appears on
 * no list of parties, or Party View, Run Order and People all start showing arrangements of one.
 * And that adding the people you run it with does not back-date them onto what already fell, which
 * would owe a share of a drop to somebody who was not in the game that night.
 */
class PartySoloTest {
    private val userId = "user_test_solo_1"
    private val dropped = LocalDate.parse("2026-07-20")

    /** The Thursday `dropped` falls after. Reset is Thursday 00:00 UTC. */
    private val weekOf20Jul = LocalDate.parse("2026-07-16")

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
        // Held in a local, not used bare: inside deleteWhere {} the table is the receiver, so a
        // bare `userId` binds to the COLUMN and the predicate matches every row. See PartyLootTest.
        val owners = listOf(userId)
        transaction {
            Party.deleteWhere { Party.userId inList owners }
            Characters.deleteWhere { Characters.userId inList owners }
            Screenshots.deleteWhere { Screenshots.userId inList owners }
        }
    }

    /** One character of this account, and nothing else. */
    private fun character(name: String = "Rune"): Uuid {
        ensureUser(userId, "$userId@example.com")
        val id = Uuid.random()
        val now = Clock.System.now()
        val owner = userId
        Characters.insert {
            it[Characters.id] = id
            it[Characters.userId] = owner
            it[Characters.name] = name
            it[Characters.worldType] = WORLD_INTERACTIVE
            it[createdAt] = now
            it[updatedAt] = now
            it[position] = 0
        }
        return id
    }

    private fun logGrindstone(
        characterId: Uuid,
        on: LocalDate = dropped,
    ): Pair<Uuid, Uuid> {
        val now = Clock.System.now()
        val bossId = bossIdForKey("limbo")!!
        val partyId = poolFor(userId, characterId, bossId, now)
        val lootId = addLoot(partyId, dropIdForKey("grindstone-of-faith")!!, null, bossId, on, now)
        return partyId to lootId
    }

    @Test
    fun `a drop on a boss run alone opens a pool that is not a party`() {
        transaction {
            val characterId = character()
            val (partyId, _) = logGrindstone(characterId)

            val pool = findParty(partyId, userId)!!
            assertTrue(pool.solo)
            // One seat, and it is the character itself, so a sale has somebody to be sold by.
            assertEquals(listOf(characterId.toString()), pool.seats.map { it.characterId })
            assertEquals(1, lootFor(partyId).size)

            // The list every party screen reads must not have it, and the one the Drop Log reads
            // must: those drops have no seats to be read against without their config.
            assertTrue(partiesFor(userId).none { it.id == partyId.toString() })
            assertTrue(partiesFor(userId, includeSolo = true).any { it.id == partyId.toString() })
        }
    }

    @Test
    fun `a second drop on the same boss goes in the pool that is already open`() {
        transaction {
            val characterId = character()
            val (first, _) = logGrindstone(characterId)
            val (second, _) = logGrindstone(characterId)

            assertEquals(first, second)
            assertEquals(2, lootFor(first).size)
        }
    }

    @Test
    fun `a drop on a boss this character has a party for goes in the party's pool`() {
        transaction {
            val characterId = character()
            val now = Clock.System.now()
            val bossId = bossIdForKey("limbo")!!
            val request = SavePartyRequest(characterId.toString(), "limbo", listOf("Steve"))
            val partyId = createParty(userId, characterId, bossId, request, now)

            // Same pool, and no solo config beside it: two pools for one character on one boss
            // would split a history nothing could add back up.
            assertEquals(partyId, poolFor(userId, characterId, bossId, now))
            assertEquals(1, partiesFor(userId, includeSolo = true).count { it.characterId == characterId.toString() })
        }
    }

    @Test
    fun `naming who you run it with turns the pool into that party, keeping its drops`() {
        transaction {
            val characterId = character()
            val (partyId, _) = logGrindstone(characterId)

            val request = SavePartyRequest(characterId.toString(), "limbo", listOf("Steve"))
            adoptSoloParty(userId, partyId, request, Clock.System.now())

            val party = findParty(partyId, userId)!!
            assertEquals(false, party.solo)
            assertEquals(listOf("Rune", "Steve"), party.seats.map { it.name })
            // The pool is the same pool. Refusing the edit and making a second config would have
            // left the history behind on a row nothing lists.
            assertEquals(1, lootFor(partyId).size)
            assertTrue(partiesFor(userId).any { it.id == partyId.toString() })
        }
    }

    @Test
    fun `a member added afterwards is not owed a share of what fell before they were there`() {
        transaction {
            val characterId = character()
            val (partyId, lootId) = logGrindstone(characterId)
            val alone = findParty(partyId, userId)!!.seats.single().id

            val request = SavePartyRequest(characterId.toString(), "limbo", listOf("Steve"))
            adoptSoloParty(userId, partyId, request, Clock.System.now())

            val sale = SellLootRequest(9_500_000_000, "LISTED", "FAIR", alone)
            sellLoot(lootId, sale, Uuid.parse(alone), partyId, Clock.System.now())

            // The whole claim: that week ran alone, so the sale owes nobody. Read from the pinned
            // roster rather than from the party as it stands, which now has Steve in it.
            assertTrue(findLoot(lootId, partyId)!!.payouts.isEmpty())
            assertEquals(listOf(Uuid.parse(alone)), rosterFor(partyId, weekOf20Jul))
        }
    }

    @Test
    fun `a boss run alone is not a party the routine editor has to be argued with`() {
        transaction {
            val characterId = character()
            logGrindstone(characterId)

            // A config locks the boss on /bosses/routine, because a party is a standing claim that
            // this character runs it. A pool of one drop is not, and there would be nothing to
            // "remove first" if it refused.
            assertNull(setBossRoutine(userId, characterId, listOf("limbo"), Clock.System.now()))
        }
    }
}
