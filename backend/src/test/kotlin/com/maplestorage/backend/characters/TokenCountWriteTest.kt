package com.maplestorage.backend.characters

import com.maplestorage.backend.config.Env
import com.maplestorage.backend.db.CharacterTokenCount
import com.maplestorage.backend.db.Characters
import com.maplestorage.backend.db.TokenCatalog
import com.maplestorage.backend.users.ensureUser
import org.flywaydb.core.Flyway
import org.jetbrains.exposed.v1.core.and
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
import kotlin.test.assertNull
import kotlin.time.Clock
import kotlin.uuid.Uuid

/**
 * Typing a count in, against a real Postgres.
 *
 * The only writer of these rows used to be a screenshot parse, so this is a second hand on the same
 * column and the two have to agree about what a row MEANS. Three things decide that and none of them
 * can be checked without a database: that a zero clears the row rather than storing a zero, that a
 * typed count over a parsed one drops the screenshot it came from, and that re-typing replaces
 * rather than stacks.
 */
class TokenCountWriteTest {
    // NOT called `userId`. Table.insert takes the table as the lambda RECEIVER, so a bare
    // `userId` inside one resolves to Characters.userId, the COLUMN, and Exposed then tries to
    // insert a column reference as a value ("invalid reference to FROM-clause entry").
    private val ownerId = "user_test_token_writes"

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
            it[Characters.userId] = ownerId
            it[Characters.name] = name
            it[createdAt] = now
            it[updatedAt] = now
            it[position] = nextPosition
        }
        return id
    }

    private fun tokenId(visionKey: String): Uuid =
        TokenCatalog
            .selectAll()
            .where { TokenCatalog.visionKey eq visionKey }
            .single()[TokenCatalog.id]

    private fun rowFor(
        characterId: Uuid,
        token: Uuid,
    ) = CharacterTokenCount
        .selectAll()
        .where {
            (CharacterTokenCount.characterId eq characterId) and
                (CharacterTokenCount.tokenCatalogId eq token)
        }.singleOrNull()

    @Test
    fun `writes a count for an item the character has never held`() =
        transaction {
            ensureUser(ownerId, "writes@example.com")
            val mine = addCharacter("TypedMain")
            val kalos = tokenId("kalos-token")

            writeTokenCount(mine, kalos, 7)

            assertEquals(7, rowFor(mine, kalos)!![CharacterTokenCount.quantity])
            rollback()
        }

    @Test
    fun `re-typing replaces rather than stacking`() =
        transaction {
            ensureUser(ownerId, "writes@example.com")
            val mine = addCharacter("TypedMain")
            val kalos = tokenId("kalos-token")

            writeTokenCount(mine, kalos, 7)
            writeTokenCount(mine, kalos, 9)

            // The count is what you HOLD, so the second answer is the answer. A running total would
            // read 16 here, which is the number nobody has ever checked against the game.
            assertEquals(9, rowFor(mine, kalos)!![CharacterTokenCount.quantity])
            rollback()
        }

    @Test
    fun `zero clears the row rather than storing a zero`() =
        transaction {
            ensureUser(ownerId, "writes@example.com")
            val mine = addCharacter("TypedMain")
            val kalos = tokenId("kalos-token")
            writeTokenCount(mine, kalos, 7)

            writeTokenCount(mine, kalos, 0)

            // No row is already how an item nobody has ever held behaves, and the read path
            // inner-joins the catalog, so a zero row would draw a literal 0 in the grid.
            assertNull(rowFor(mine, kalos))
            rollback()
        }

    @Test
    fun `a typed count over a parsed one drops the screenshot it came from`() =
        transaction {
            ensureUser(ownerId, "writes@example.com")
            val mine = addCharacter("TypedMain")
            val kalos = tokenId("kalos-token")
            // As a parse leaves it, minus the screenshot row itself: the FK is nullable and this
            // test is about what the WRITE does to the column, not about ingestion.
            CharacterTokenCount.insert {
                it[characterId] = mine
                it[tokenCatalogId] = kalos
                it[quantity] = 3
                it[capturedAt] = Clock.System.now()
            }

            writeTokenCount(mine, kalos, 11)

            val row = rowFor(mine, kalos)!!
            assertEquals(11, row[CharacterTokenCount.quantity])
            // The screenshot no longer describes this figure, so the row must not still point at
            // one. Nothing else marks a count as hand-typed; this null IS the mark.
            assertNull(row[CharacterTokenCount.sourceScreenshotId])
            rollback()
        }

    @Test
    fun `clearing an item the character never held is not an error`() =
        transaction {
            ensureUser(ownerId, "writes@example.com")
            val mine = addCharacter("TypedMain")

            writeTokenCount(mine, tokenId("kalos-token"), 0)

            assertNull(rowFor(mine, tokenId("kalos-token")))
            rollback()
        }
}
