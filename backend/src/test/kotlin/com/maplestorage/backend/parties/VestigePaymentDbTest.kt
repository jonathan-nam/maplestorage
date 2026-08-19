package com.maplestorage.backend.parties

import com.maplestorage.backend.config.Env
import com.maplestorage.backend.db.Person
import com.maplestorage.backend.db.Users
import com.maplestorage.backend.db.VestigePayment
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
import kotlin.time.Clock
import kotlin.uuid.Uuid

/**
 * V64's note, against a real Postgres.
 *
 * A field can be added to the table, written by the route and still never reach the client, because
 * the read is its own hand-written mapping. Then the box takes what you type and the receipt comes
 * back blank, with nothing failing anywhere. Worth a database for the same reason V56's attribution
 * was.
 */
class VestigePaymentDbTest {
    private val userId = "user_test_payment_note_1"

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
            VestigePayment.deleteWhere { VestigePayment.userId inList owners }
            Person.deleteWhere { Person.userId inList owners }
            Users.deleteWhere { Users.id inList owners }
        }
    }

    @Test
    fun `a payment's note comes back on the row it was written with`() {
        transaction {
            ensureUser(userId, "payment@example.com")
            val now = Clock.System.now()

            // Two, so a note landing on the wrong receipt is told from one surviving at all.
            for ((amount, what) in listOf(1_500_000_000L to "Kalos run", 250_000_000L to null)) {
                VestigePayment.insert {
                    it[id] = Uuid.random()
                    it[VestigePayment.userId] = this@VestigePaymentDbTest.userId
                    it[holderKind] = "CHARACTER"
                    it[personId] = null
                    it[characterName] = "macaroon"
                    it[VestigePayment.amount] = amount
                    it[note] = what
                    it[receivedAt] = now
                    it[createdAt] = now
                }
            }

            val rows = paymentsFor(userId).sortedByDescending { it.amount }
            assertEquals(2, rows.size)
            assertEquals("Kalos run", rows[0].note)
            // Still optional, and an absent one is absent rather than an empty string: the card
            // draws the plain receipt off exactly that.
            assertNull(rows[1].note)
        }
    }
}
