package com.maplestorage.backend.users

import com.maplestorage.backend.config.Env
import com.maplestorage.backend.db.Characters
import org.flywaydb.core.Flyway
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.jdbc.Database
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlin.time.Clock
import kotlin.uuid.Uuid

/**
 * `trades`, the one thing the account-wide screens are allowed to read.
 *
 * An account can hold characters in both worlds, so "can this account trade" is a question about
 * the SET of them, not about users.world_type. Answering it from the stored world instead would
 * take the Split Utility off the menu and the meso totals off the Drop Log for somebody whose
 * Interactive character is still earning, which is money hidden behind a default nobody set.
 */
class AccountWorldTest {
    private val userId = "user_test_world_1"

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
        // Held in a local: inside deleteWhere {} the table is the receiver, so a bare `userId`
        // binds to the COLUMN and the predicate is true of every row. See PartyLootTest.
        val owner = userId
        transaction { Characters.deleteWhere { Characters.userId eq owner } }
    }

    private fun character(
        name: String,
        world: String,
    ) {
        val owner = userId
        val now = Clock.System.now()
        Characters.insert {
            it[Characters.id] = Uuid.random()
            it[Characters.userId] = owner
            it[Characters.name] = name
            it[Characters.worldType] = world
            it[createdAt] = now
            it[updatedAt] = now
            it[position] = 0
        }
    }

    @Test
    fun `one Interactive character among Heroic ones still trades`() {
        transaction {
            ensureUser(userId, "$userId@example.com")
            character("Rune", WORLD_HEROIC)
            character("Steve", WORLD_HEROIC)
            character("mechyfechy", WORLD_INTERACTIVE)

            assertTrue(settingsFor(userId).trades)
        }
    }

    @Test
    fun `an account entirely in Heroic worlds does not trade`() {
        transaction {
            ensureUser(userId, "$userId@example.com")
            character("Rune", WORLD_HEROIC)
            character("Steve", WORLD_HEROIC)

            assertFalse(settingsFor(userId).trades)
        }
    }

    @Test
    fun `an account with no characters yet trades`() {
        transaction {
            ensureUser(userId, "$userId@example.com")
            // Nothing to be missing from yet, so a first-time page is not quietly half-drawn.
            assertTrue(settingsFor(userId).trades)
        }
    }

    @Test
    fun `the stored world is a default for the next character, not a claim about the account`() {
        transaction {
            ensureUser(userId, "$userId@example.com")
            // Every character moved to Heroic by hand, one at a time, which is what the settings
            // page's per-character rows do. users.world_type is untouched by that, and reading it
            // as the account's answer would say this account still trades. `trades` says it does
            // not, which is the truth.
            character("Rune", WORLD_HEROIC)

            val settings = settingsFor(userId)
            assertEquals(WORLD_INTERACTIVE, settings.worldType)
            assertFalse(settings.trades)
        }
    }
}
