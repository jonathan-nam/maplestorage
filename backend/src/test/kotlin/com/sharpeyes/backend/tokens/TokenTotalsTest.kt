package com.sharpeyes.backend.tokens

import com.sharpeyes.backend.config.Env
import com.sharpeyes.backend.db.CharacterTokenCount
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.TokenCatalog
import com.sharpeyes.backend.users.ensureUser
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
import kotlin.test.assertTrue
import kotlin.time.Clock
import kotlin.uuid.Uuid

// Exercises tokenTotalsFor() (the aggregate behind /api/tokens) against a real
// Postgres, because the two things most likely to be wrong about it are things
// only a database can tell you: whether the GROUP BY is valid SQL at all, and
// whether the ownership filter actually excludes other users' characters.
class TokenTotalsTest {
    private val userOneId = "user_test_totals_1"
    private val userTwoId = "user_test_totals_2"

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
            // character_token_count cascades off characters via FK, so drop the
            // counts first.
            val ids =
                Characters
                    .selectAll()
                    .where { (Characters.userId eq userOneId) or (Characters.userId eq userTwoId) }
                    .map { it[Characters.id] }
            ids.forEach { id -> CharacterTokenCount.deleteWhere { characterId eq id } }
            Characters.deleteWhere { (Characters.userId eq userOneId) or (Characters.userId eq userTwoId) }
        }
    }

    private fun addCharacter(
        userId: String,
        name: String,
    ): Uuid {
        val id = Uuid.random()
        val now = Clock.System.now()
        // position is NOT NULL and app-assigned (no DB default), dense per user. Mirror the
        // route's append: the count of this user's rows is the next free slot. See CharacterRoutes.
        val nextPosition =
            Characters
                .selectAll()
                .where { Characters.userId eq userId }
                .count()
                .toInt()
        Characters.insert {
            it[Characters.id] = id
            it[Characters.userId] = userId
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
        val catalogId =
            TokenCatalog
                .selectAll()
                .where { TokenCatalog.visionKey eq visionKey }
                .single()[TokenCatalog.id]
        CharacterTokenCount.insert {
            it[CharacterTokenCount.characterId] = characterId
            it[tokenCatalogId] = catalogId
            it[CharacterTokenCount.quantity] = quantity
            it[capturedAt] = Clock.System.now()
        }
    }

    @Test
    fun `sums a token across characters and counts the contributors`() =
        transaction {
            ensureUser(userOneId, "one@example.com")
            val main = addCharacter(userOneId, "TotalsMain")
            val mule = addCharacter(userOneId, "TotalsMule")

            addCount(main, "kalos-token", 19)
            addCount(mule, "kalos-token", 21)
            // Only one character holds this one, so it must report 1 contributor
            // even though the user has two characters.
            addCount(main, "distorted-ambition", 9)

            val totals = tokenTotalsFor(userOneId)

            val kalos = totals.single { it.name.startsWith("Kalos") }
            assertEquals(40, kalos.quantity)
            assertEquals(2, kalos.characterCount)

            val ambition = totals.single { it.name == "Distorted Ambition" }
            assertEquals(9, ambition.quantity)
            assertEquals(1, ambition.characterCount)

            // Tokens nobody holds are absent rather than present-with-zero: the
            // inventory panel renders a missing token as an empty slot.
            assertEquals(2, totals.size)
        }

    @Test
    fun `one user's counts never appear in another user's totals`() =
        transaction {
            ensureUser(userOneId, "one@example.com")
            ensureUser(userTwoId, "two@example.com")

            addCount(addCharacter(userOneId, "TotalsMine"), "kalos-token", 19)
            addCount(addCharacter(userTwoId, "TotalsTheirs"), "kalos-token", 500)

            val mine = tokenTotalsFor(userOneId)
            assertEquals(19, mine.single().quantity)
            assertEquals(1, mine.single().characterCount)

            // The failure this guards against is silent: without the ownership
            // filter the join still returns a row, just with everyone's counts
            // added in, which looks like a plausible number rather than a bug.
            assertTrue(mine.none { it.quantity == 519 })
        }
}
