package com.sharpeyes.backend.tokens

import com.sharpeyes.backend.characters.characterTokensFor
import com.sharpeyes.backend.characters.isAddableToken
import com.sharpeyes.backend.config.Env
import com.sharpeyes.backend.db.CharacterTokenCount
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.TokenCatalog
import com.sharpeyes.backend.users.WORLD_INTERACTIVE
import com.sharpeyes.backend.users.ensureUser
import com.sharpeyes.backend.users.setActiveWorld
import org.flywaydb.core.Flyway
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.jdbc.Database
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.selectAll
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
 * The inventory counts boss tokens and nothing else.
 *
 * Run against a real Postgres because the claim is about the SEED: the filter is a string match on
 * item_group, so it and catalog/items.yaml have to agree about what that string is. They can stop
 * agreeing without anything failing to compile, and the symptom is an inventory that is simply
 * empty, which reads as "no tokens yet" rather than as a bug.
 */
class BossTokensOnlyTest {
    private val ownerId = "user_test_boss_tokens_only"

    // Held by a character in the fixture below, and must not come back from any read. A symbol and
    // an elixir, one from each group that was dropped.
    private val symbolKey = "arcane-vanishing-journey"
    private val elixirKey = "sayram-elixir"
    private val bossTokenKey = "kalos-token"

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
            val ids =
                Characters
                    .selectAll()
                    .where { Characters.userId eq ownerId }
                    .map { it[Characters.id] }
            ids.forEach { id -> CharacterTokenCount.deleteWhere { characterId eq id } }
            Characters.deleteWhere { Characters.userId eq ownerId }
        }
    }

    private fun catalogId(visionKey: String): Uuid =
        TokenCatalog
            .selectAll()
            .where { TokenCatalog.visionKey eq visionKey }
            .single()[TokenCatalog.id]

    private fun addCharacter(name: String): Uuid {
        val id = Uuid.random()
        val now = Clock.System.now()
        val nextPosition =
            Characters
                .selectAll()
                .where { Characters.userId eq ownerId }
                .count()
                .toInt()
        Characters.insert {
            it[Characters.id] = id
            it[userId] = ownerId
            it[Characters.name] = name
            it[createdAt] = now
            it[updatedAt] = now
            it[position] = nextPosition
        }
        return id
    }

    private fun addCount(
        characterId: Uuid,
        visionKey: String,
        quantity: Int,
    ) {
        CharacterTokenCount.insert {
            it[CharacterTokenCount.characterId] = characterId
            it[tokenCatalogId] = catalogId(visionKey)
            it[CharacterTokenCount.quantity] = quantity
            it[capturedAt] = Clock.System.now()
        }
    }

    @Test
    fun `the + offers boss tokens and nothing else`() =
        transaction {
            val offered = bossTokenCatalog()

            assertTrue(offered.isNotEmpty(), "an empty catalog is the group having been renamed")
            assertTrue(offered.all { it.itemGroup == BOSS_TOKEN_GROUP })
            assertTrue(offered.any { it.name == "Kalos's Residual Determination" })
            assertTrue(offered.none { it.name.startsWith("Arcane Symbol") })
            assertTrue(offered.none { it.name.endsWith("Elixir") })
        }

    @Test
    fun `a symbol a character holds is left out of their inventory`() =
        transaction {
            ensureUser(ownerId, "boss-tokens@example.com")
            setActiveWorld(ownerId, WORLD_INTERACTIVE)
            val main = addCharacter("BossTokensMain")

            addCount(main, bossTokenKey, 7)
            addCount(main, symbolKey, 5)
            addCount(main, elixirKey, 3)

            val held = characterTokensFor(main)

            // The row is still there. The read is what narrowed, so widening the scope again does
            // not have to recover anything.
            assertEquals(3, CharacterTokenCount.selectAll().where { CharacterTokenCount.characterId eq main }.count())
            assertEquals(listOf("Kalos's Residual Determination"), held.map { it.name })
            assertEquals(7, held.single().quantity)
        }

    @Test
    fun `the aggregate counts the same items the grid does`() =
        transaction {
            ensureUser(ownerId, "boss-tokens@example.com")
            setActiveWorld(ownerId, WORLD_INTERACTIVE)
            val main = addCharacter("BossTokensTotals")

            addCount(main, bossTokenKey, 7)
            addCount(main, symbolKey, 5)

            // Two reads, one answer. A total that still pooled the symbol would be a larger number
            // than the grid it sits over, and a plausible one.
            val totals = tokenTotalsFor(ownerId)
            assertEquals(listOf("Kalos's Residual Determination"), totals.map { it.name })
            assertEquals(7, totals.single().quantity)
        }

    @Test
    fun `a count cannot be written for an item the + cannot offer`() =
        transaction {
            assertTrue(isAddableToken(catalogId(bossTokenKey)))
            assertFalse(isAddableToken(catalogId(symbolKey)))
            assertFalse(isAddableToken(catalogId(elixirKey)))
        }
}
