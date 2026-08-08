package com.maplestorage.backend.parties

import com.maplestorage.backend.config.Env
import com.maplestorage.backend.db.Person
import com.maplestorage.backend.db.Users
import com.maplestorage.backend.db.VestigeTranche
import com.maplestorage.backend.users.ensureUser
import org.flywaydb.core.Flyway
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.jdbc.Database
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import org.jetbrains.exposed.v1.jdbc.update
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
 * A holder's sale tally, against a real Postgres.
 *
 * Three claims are worth a database. That the tally comes back OLDEST FIRST, because that is the
 * order the queue spends it in and reversing it would re-price every boss. That it is scoped to the
 * account, since it is read without naming a party and an account-wide read is where a missing
 * `where` shows up as somebody else's sales. And that the holder columns cannot disagree with the
 * kind, which is the constraint standing between a pile and belonging to nobody.
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
            Person.deleteWhere { Person.userId inList owners }
            Users.deleteWhere { Users.id inList owners }
        }
    }

    /** Somebody on the people list, which is what a PERSON tranche is filed against. */
    private fun person(
        owner: String,
        name: String,
    ): Uuid {
        val id = Uuid.random()
        val now = Clock.System.now()
        Person.insert {
            it[Person.id] = id
            it[userId] = owner
            it[Person.name] = name
            it[createdAt] = now
            it[updatedAt] = now
        }
        return id
    }

    private fun tranche(
        owner: String,
        holder: Uuid?,
        pieces: Int,
        amount: Long,
        hoursAgo: Long,
    ) {
        val now = Clock.System.now()
        VestigeTranche.insert {
            it[id] = Uuid.random()
            it[userId] = owner
            it[holderKind] = if (holder == null) "SELF" else "PERSON"
            it[personId] = holder
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
            tranche(userId, null, 10, 250_000_000, hoursAgo = 1)
            tranche(userId, null, 50, 1_200_000_000, hoursAgo = 5)

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
            tranche(userId, null, 50, 1_200_000_000, hoursAgo = 2)
            tranche(strangerId, null, 999, 9_000_000_000, hoursAgo = 2)

            assertEquals(1, tranchesFor(userId).size)
            assertEquals(50, tranchesFor(userId).single().pieces)
        }
    }

    @Test
    fun `two people keep separate piles under one account`() {
        transaction {
            ensureUser(userId, "$userId@example.com")
            // Yours, and the partner who loots the bosses run on characters that are not on your
            // account. Both tallies are yours to enter; neither can spend the other's pieces.
            val bro = person(userId, "Bro")
            tranche(userId, null, 60, 1_450_000_000, hoursAgo = 3)
            tranche(userId, bro, 20, 500_000_000, hoursAgo = 2)

            val byHolder = tranchesFor(userId).groupBy { it.holder.kind }
            assertEquals(setOf("SELF", "PERSON"), byHolder.keys)
            assertEquals(60, byHolder["SELF"]!!.single().pieces)
            assertEquals(bro.toString(), byHolder["PERSON"]!!.single().holder.personId)
        }
    }

    @Test
    fun `one person's pile survives being renamed, because it is filed by id`() {
        transaction {
            ensureUser(userId, "$userId@example.com")
            val bro = person(userId, "Bro")
            tranche(userId, bro, 40, 900_000_000, hoursAgo = 1)

            Person.update({ Person.id eq bro }) { it[name] = "Brody" }

            // The pile is still one pile. A name-keyed tally would have orphaned it here, and every
            // boss it covered would have re-priced to nothing with no error.
            assertEquals(40, tranchesFor(userId).single().pieces)
        }
    }

    @Test
    fun `a tranche is refused rather than stored wrong`() {
        val self = VestigeHolder(kind = "SELF")
        val bro = VestigeHolder(kind = "PERSON", personId = Uuid.random().toString())
        val stranger = VestigeHolder(kind = "CHARACTER", characterName = "husky")

        assertNull(trancheRefusal(self, 50, 1_200_000_000))
        assertNull(trancheRefusal(bro, 50, 1_200_000_000))
        assertNull(trancheRefusal(stranger, 50, 1_200_000_000))
        // A stack handed over rather than sold is a real thing to record, and it prices that boss at
        // nothing rather than refusing to price it at all.
        assertNull(trancheRefusal(self, 30, 0))

        // The kind and the reference cannot disagree, which is what keeps a pile from belonging to
        // nobody and pricing every boss it covers at zero.
        assertTrue(trancheRefusal(VestigeHolder(kind = "NOBODY"), 50, 1)!!.contains("kind"))
        assertTrue(trancheRefusal(VestigeHolder(kind = "PERSON"), 50, 1)!!.contains("personId"))
        assertTrue(trancheRefusal(VestigeHolder(kind = "CHARACTER"), 50, 1)!!.contains("characterName"))
        assertTrue(trancheRefusal(self.copy(personId = "x"), 50, 1)!!.contains("personId"))
        assertTrue(
            trancheRefusal(VestigeHolder(kind = "PERSON", personId = "not-an-id"), 50, 1)!!
                .contains("not an id"),
        )

        assertTrue(trancheRefusal(self, 0, 1)!!.contains("between 1"))
        assertTrue(trancheRefusal(self, 1_000_001, 1)!!.contains("1000000"))
        assertTrue(trancheRefusal(self, 50, -1)!!.contains("negative"))
    }

    @Test
    fun `a name arrives folded, so one pile cannot come back as two`() {
        val loud = VestigeHolder(kind = " character ", characterName = "  Husky  ")
        assertEquals(VestigeHolder("CHARACTER", null, "husky"), loud.normalised())
    }
}
