package com.maplestorage.backend.parties

import com.maplestorage.backend.config.Env
import com.maplestorage.backend.db.Users
import com.maplestorage.backend.db.VestigeTranche
import com.maplestorage.backend.users.ensureUser
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
import kotlin.time.Duration.Companion.hours
import kotlin.uuid.Uuid

/**
 * A looter's sale tally, against a real Postgres.
 *
 * Two claims are worth a database. That the tally comes back OLDEST FIRST, because that is the order
 * the queue spends it in and reversing it would re-price every boss. And that it is scoped to the
 * account, since it is read without naming a party and an account-wide read is where a missing
 * `where` shows up as somebody else's sales.
 */
class VestigeTrancheTest {
    private val userId = "user_test_tranche_1"
    private val strangerId = "user_test_tranche_2"

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
        val owners = listOf(userId, strangerId)
        transaction {
            VestigeTranche.deleteWhere { VestigeTranche.userId inList owners }
            Users.deleteWhere { Users.id inList owners }
        }
    }

    private fun tranche(
        owner: String,
        looter: String,
        pieces: Int,
        amount: Long,
        hoursAgo: Long,
    ) {
        val now = Clock.System.now()
        VestigeTranche.insert {
            it[id] = Uuid.random()
            it[userId] = owner
            it[looterName] = looter
            it[VestigeTranche.pieces] = pieces
            it[VestigeTranche.amount] = amount
            it[soldAt] = now - hoursAgo.hours
            it[createdAt] = now
        }
    }

    @Test
    fun `the tally comes back oldest first, which is the order the queue spends it`() {
        transaction {
            ensureUser(userId, "$userId@example.com")
            tranche(userId, "husky", 10, 250_000_000, hoursAgo = 1)
            tranche(userId, "husky", 50, 1_200_000_000, hoursAgo = 5)

            val rows = tranchesFor(userId)
            assertEquals(listOf(50, 10), rows.map { it.pieces })
            // The total is what was entered; nothing here divides it into a price each.
            assertEquals(listOf(1_200_000_000L, 250_000_000L), rows.map { it.amount })
        }
    }

    @Test
    fun `one account never sees another's sales`() {
        transaction {
            ensureUser(userId, "$userId@example.com")
            ensureUser(strangerId, "$strangerId@example.com")
            tranche(userId, "husky", 50, 1_200_000_000, hoursAgo = 2)
            tranche(strangerId, "husky", 999, 9_000_000_000, hoursAgo = 2)

            assertEquals(1, tranchesFor(userId).size)
            assertEquals(50, tranchesFor(userId).single().pieces)
        }
    }

    @Test
    fun `two looters keep separate piles under one account`() {
        transaction {
            ensureUser(userId, "$userId@example.com")
            // Yours, and the partner who loots the bosses run on a character that is not on your
            // account. Both tallies are yours to enter; neither can spend the other's pieces.
            tranche(userId, "husky", 60, 1_450_000_000, hoursAgo = 3)
            tranche(userId, "rune", 20, 500_000_000, hoursAgo = 2)

            val byLooter = tranchesFor(userId).groupBy { it.looterName }
            assertEquals(setOf("husky", "rune"), byLooter.keys)
            assertEquals(60, byLooter["husky"]!!.single().pieces)
        }
    }

    @Test
    fun `a tranche is refused rather than stored wrong`() {
        assertNull(trancheRefusal("husky", 50, 1_200_000_000))
        // A stack handed over rather than sold is a real thing to record, and it prices that boss at
        // nothing rather than refusing to price it at all.
        assertNull(trancheRefusal("husky", 30, 0))

        assertTrue(trancheRefusal("", 50, 1)!!.contains("cannot be blank"))
        assertTrue(trancheRefusal("husky", 0, 1)!!.contains("between 1"))
        assertTrue(trancheRefusal("husky", 1_000_001, 1)!!.contains("1000000"))
        assertTrue(trancheRefusal("husky", 50, -1)!!.contains("negative"))
    }
}
