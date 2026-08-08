package com.maplestorage.backend.parties

import com.maplestorage.backend.config.Env
import com.maplestorage.backend.db.Characters
import com.maplestorage.backend.db.Party
import com.maplestorage.backend.db.Person
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
import kotlin.test.assertTrue
import kotlin.time.Clock
import kotlin.uuid.Uuid

/**
 * The drops a clear implies, against a real Postgres.
 *
 * Vestige coupons are guaranteed and the catalog knows the amount, so clearing the boss already says
 * they landed. What is worth a database to check is everything this must NOT do: file twice for one
 * period, file at a difficulty that drops none, file where nobody has said which difficulty, or take
 * back a row somebody has already sold.
 */
class LootFromClearTest {
    private val userId = "user_test_from_clear_1"
    private val today = LocalDate.parse("2026-08-08")

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
        val owners = listOf(userId)
        transaction {
            Party.deleteWhere { Party.userId inList owners }
            Person.deleteWhere { Person.userId inList owners }
            Characters.deleteWhere { Characters.userId inList owners }
            Screenshots.deleteWhere { Screenshots.userId inList owners }
        }
    }

    /** A party on Extreme Kalos, which drops 180 coupons, unless [difficulty] says otherwise. */
    private fun party(difficulty: String? = "EXTREME"): Pair<Uuid, Uuid> {
        ensureUser(userId, "$userId@example.com")
        val mine = Uuid.random()
        val now = Clock.System.now()
        val owner = userId
        Characters.insert {
            it[Characters.id] = mine
            it[Characters.userId] = owner
            it[Characters.name] = "Husky"
            it[Characters.worldType] = WORLD_INTERACTIVE
            it[createdAt] = now
            it[updatedAt] = now
            it[position] = 0
        }
        val bossId = bossIdForKey("kalos-the-guardian")!!
        val request =
            SavePartyRequest(mine.toString(), "kalos-the-guardian", listOf("Steve"), difficulty = difficulty)
        return mine to createParty(userId, mine, bossId, request, now)
    }

    private fun pool(partyId: Uuid) = lootFor(partyId)

    @Test
    fun `clearing a boss files what it guarantees, with the catalog's own count`() {
        transaction {
            val (characterId, partyId) = party()
            val bossId = bossIdForKey("kalos-the-guardian")!!

            lootFromClear(characterId, bossId, "WEEKLY", today, Clock.System.now())

            val row = pool(partyId).single()
            assertEquals("Vestige of Erion Coupon", row.name)
            assertEquals(180, row.quantity)
            assertEquals("kalos-the-guardian", row.bossKey)
        }
    }

    @Test
    fun `re-ticking the same clear does not stack up a second row`() {
        transaction {
            val (characterId, partyId) = party()
            val bossId = bossIdForKey("kalos-the-guardian")!!
            val now = Clock.System.now()

            lootFromClear(characterId, bossId, "WEEKLY", today, now)
            lootFromClear(characterId, bossId, "WEEKLY", today, now)
            // Two days later in the same week, which is the same period and so the same 180.
            lootFromClear(characterId, bossId, "WEEKLY", LocalDate.parse("2026-08-10"), now)

            assertEquals(1, pool(partyId).size)
        }
    }

    @Test
    fun `says nothing where the amount is unknown`() {
        transaction {
            // Chaos Kalos drops none, and the catalog carries no row for it rather than a zero.
            val (chaosCharacter, chaosParty) = party(difficulty = "CHAOS")
            lootFromClear(
                chaosCharacter,
                bossIdForKey("kalos-the-guardian")!!,
                "WEEKLY",
                today,
                Clock.System.now(),
            )
            assertTrue(pool(chaosParty).isEmpty())
        }
        cleanUp()
        transaction {
            // And a config where nobody has said which difficulty cannot know which amount applies.
            val (quietCharacter, quietParty) = party(difficulty = null)
            lootFromClear(
                quietCharacter,
                bossIdForKey("kalos-the-guardian")!!,
                "WEEKLY",
                today,
                Clock.System.now(),
            )
            assertTrue(pool(quietParty).isEmpty())
        }
    }

    @Test
    fun `un-ticking takes back what the clear added, and leaves a sale alone`() {
        transaction {
            val (characterId, partyId) = party()
            val bossId = bossIdForKey("kalos-the-guardian")!!
            val now = Clock.System.now()

            lootFromClear(characterId, bossId, "WEEKLY", today, now)
            unlootFromClear(characterId, bossId, "WEEKLY", today)
            assertTrue(pool(partyId).isEmpty(), "a row the clear added and nobody touched goes with it")

            // Sold, and now the clear is un-ticked: that is money somebody is owed, and un-ticking a
            // clear says nothing about it.
            lootFromClear(characterId, bossId, "WEEKLY", today, now)
            val row = pool(partyId).single()
            val seller = findParty(partyId, userId)!!.members.first()
            sellLoot(
                Uuid.parse(row.id),
                SellLootRequest(4_420_000_000, "RECEIVED", "FAIR", seller.id),
                Uuid.parse(seller.id),
                partyId,
                now,
            )
            unlootFromClear(characterId, bossId, "WEEKLY", today)
            assertEquals(1, pool(partyId).size)
        }
    }

    @Test
    fun `a row a human logged is never taken back by a clear`() {
        transaction {
            val (characterId, partyId) = party()
            val bossId = bossIdForKey("kalos-the-guardian")!!
            val now = Clock.System.now()
            // Typed, not filed from a clear: they saw it fall, so the clear does not answer for it.
            addLoot(partyId, LootedDrop(dropIdForKey("vestige-of-erion")!!, quantity = 60), bossId, today, now)

            unlootFromClear(characterId, bossId, "WEEKLY", today)

            assertEquals(60, pool(partyId).single().quantity)
        }
    }
}
