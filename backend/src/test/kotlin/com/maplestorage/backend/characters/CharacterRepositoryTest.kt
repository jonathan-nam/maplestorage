package com.maplestorage.backend.characters

import com.maplestorage.backend.config.Env
import com.maplestorage.backend.db.Characters
import com.maplestorage.backend.users.ensureUser
import org.flywaydb.core.Flyway
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.or
import org.jetbrains.exposed.v1.jdbc.Database
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import org.jetbrains.exposed.v1.jdbc.update
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.time.Clock
import kotlin.uuid.Uuid

// Exercises the same Exposed query shapes CharacterRoutes.kt's handlers use
// (insert/select/update/delete, ownership filtering) directly against a
// real Postgres -- same DB_* contract as TokenCatalogSeedTest.kt -- without
// going through Ktor's routing/auth layer. Ownership-scoping (a real user
// never seeing another user's rows) is the trickiest correctness property
// here, so it gets its own dedicated assertion below.
class CharacterRepositoryTest {
    private val userOneId = "user_test_repo_1"
    private val userTwoId = "user_test_repo_2"

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
            Characters.deleteWhere { (Characters.userId eq userOneId) or (Characters.userId eq userTwoId) }
        }
    }

    @Test
    fun `insert, update, and delete round-trip for a single character`() =
        transaction {
            ensureUser(userOneId, "one@example.com")
            val id = insertCharacter(userOneId, "Bubbling")

            val created = findOwnedCharacter(id, userOneId)
            assertEquals("Bubbling", created?.name)
            assertNull(created?.level)

            Characters.update({ (Characters.id eq id) and (Characters.userId eq userOneId) }) { row ->
                row[level] = 285
            }
            assertEquals(285, findOwnedCharacter(id, userOneId)?.level)

            val rowsDeleted = Characters.deleteWhere { (Characters.id eq id) and (Characters.userId eq userOneId) }
            assertEquals(1, rowsDeleted)
            assertNull(findOwnedCharacter(id, userOneId))
        }

    @Test
    fun `ownership filtering excludes another user's characters`() =
        transaction {
            ensureUser(userOneId, "one@example.com")
            ensureUser(userTwoId, "two@example.com")
            val userOneCharacterId = insertCharacter(userOneId, "Squishy")
            insertCharacter(userTwoId, "Nightshade")

            val userOneList =
                Characters
                    .selectAll()
                    .where { Characters.userId eq userOneId }
                    .map { it[Characters.name] }
            assertEquals(listOf("Squishy"), userOneList)

            // userTwo's JWT looking up userOne's character id must find nothing.
            assertNull(findOwnedCharacter(userOneCharacterId, userTwoId))
        }

    private fun insertCharacter(
        userId: String,
        name: String,
    ): Uuid {
        val id = Uuid.random()
        val now = Clock.System.now()
        Characters.insert {
            it[Characters.id] = id
            it[Characters.userId] = userId
            it[Characters.name] = name
            it[createdAt] = now
            it[updatedAt] = now
        }
        return id
    }
}
