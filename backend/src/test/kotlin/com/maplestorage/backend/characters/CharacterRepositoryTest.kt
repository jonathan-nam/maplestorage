package com.maplestorage.backend.characters

import com.maplestorage.backend.config.Env
import com.maplestorage.backend.db.CharacterTokenCount
import com.maplestorage.backend.db.Characters
import com.maplestorage.backend.db.Screenshots
import com.maplestorage.backend.db.TokenCatalog
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
import kotlin.test.assertNotNull
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

    // Deleting a character used to 500 the moment the character had any data -- both
    // character_token_count and screenshots referenced it with ON DELETE NO ACTION, so
    // the foreign key blocked the delete. The existing round-trip test above passed
    // only because it deletes a character that was never used.
    //
    // The two references want different answers, and this pins both: the counts are
    // that character's inventory and go with them (CASCADE); the screenshot is a record
    // of something the user actually uploaded and outlives the attribution (SET NULL),
    // so deleting a mis-read character does not also erase the upload that produced it.
    @Test
    fun `deleting a character takes its token counts and orphans its screenshots`() =
        transaction {
            ensureUser(userOneId, "one@example.com")
            val characterId = insertCharacter(userOneId, "Doomed")
            val catalogId =
                TokenCatalog
                    .selectAll()
                    .where { TokenCatalog.visionKey eq "kalos-token" }
                    .single()[TokenCatalog.id]

            val screenshotId = Uuid.random()
            Screenshots.insert {
                it[id] = screenshotId
                it[Screenshots.userId] = userOneId
                it[Screenshots.characterId] = characterId
                it[uploadedAt] = Clock.System.now()
                it[parseStatus] = "SUCCESS"
            }
            CharacterTokenCount.insert {
                it[CharacterTokenCount.characterId] = characterId
                it[tokenCatalogId] = catalogId
                it[quantity] = 7
                it[capturedAt] = Clock.System.now()
            }

            // This is the call that used to throw.
            val rowsDeleted =
                Characters.deleteWhere { (Characters.id eq characterId) and (Characters.userId eq userOneId) }
            assertEquals(1, rowsDeleted)

            val countsLeft =
                CharacterTokenCount
                    .selectAll()
                    .where { CharacterTokenCount.characterId eq characterId }
                    .count()
            assertEquals(0, countsLeft, "token counts should have gone with the character")

            val screenshot =
                Screenshots
                    .selectAll()
                    .where { Screenshots.id eq screenshotId }
                    .singleOrNull()
            assertNotNull(screenshot, "the screenshot itself must survive")
            assertNull(screenshot[Screenshots.characterId], "but it must no longer be attributed")

            Screenshots.deleteWhere { Screenshots.id eq screenshotId }
        }
}
