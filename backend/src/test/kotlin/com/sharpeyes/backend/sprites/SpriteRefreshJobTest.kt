package com.sharpeyes.backend.sprites

import com.sharpeyes.backend.config.Env
import com.sharpeyes.backend.db.CharacterSprite
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.services.NexonLookupService
import com.sharpeyes.backend.users.WORLD_INTERACTIVE
import com.sharpeyes.backend.users.ensureUser
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import io.ktor.serialization.kotlinx.json.json
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import org.flywaydb.core.Flyway
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
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
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.time.Clock
import kotlin.time.Duration
import kotlin.time.Duration.Companion.days
import kotlin.time.Duration.Companion.hours
import kotlin.time.Instant
import kotlin.uuid.Uuid

/**
 * The daily re-ask, and the two columns that keep it from becoming a loop.
 *
 * An outfit is the player's to change and nothing tells us when they have, so the sprite URL is
 * re-asked for on a clock. The failure to avoid is a name that no longer ranks: the lookup answers
 * nothing, the good data is deliberately left alone, and if the batch were picked on "when did we
 * last get an ANSWER" that character would be re-asked every tick forever.
 *
 * Selection is asserted by membership and never by count. The query is account-wide by design, so a
 * count here would really be a count of the dev database.
 */
class SpriteRefreshJobTest {
    private val userId = "user_test_sprite_refresh"
    private val oldUrl = "https://msavatar1.nexon.net/Character/OLDFIT.png"
    private val newUrl = "https://msavatar1.nexon.net/Character/NEWFIT.png"
    private val png = TEST_PNG

    @BeforeTest
    fun migrate() {
        val jdbcUrl = "jdbc:postgresql://${Env.dbHost}:${Env.dbPort}/${Env.dbName}"
        Flyway
            .configure()
            .dataSource(jdbcUrl, Env.dbUsername, Env.dbPassword)
            .load()
            .migrate()
        Database.connect(jdbcUrl, driver = "org.postgresql.Driver", user = Env.dbUsername, password = Env.dbPassword)
    }

    @AfterTest
    fun cleanUp() {
        val owner = userId
        val keys = listOf(spriteKey(oldUrl), spriteKey(newUrl))
        transaction {
            Characters.deleteWhere { Characters.userId eq owner }
            CharacterSprite.deleteWhere { CharacterSprite.urlSha256 inList keys }
        }
    }

    /** A character last asked about [checkedAgo] ago (null for never), wearing [oldUrl]. */
    private fun character(
        checkedAgo: Duration?,
        name: String = "refreshtest",
    ): SpriteRefreshJob.Due {
        val id = Uuid.random()
        val now = Clock.System.now()
        transaction {
            ensureUser(userId, "$userId@example.com")
            Characters.insert {
                it[Characters.id] = id
                it[Characters.userId] = this@SpriteRefreshJobTest.userId
                it[Characters.name] = name
                it[worldType] = WORLD_INTERACTIVE
                it[spriteImgUrl] = oldUrl
                it[spriteRefreshedAt] = checkedAgo?.let { ago -> now - ago }
                it[spriteCheckedAt] = checkedAgo?.let { ago -> now - ago }
                it[createdAt] = now
                it[updatedAt] = now
                it[position] = 0
            }
        }
        return SpriteRefreshJob.Due(id, userId, name)
    }

    /**
     * A job whose lookup answers with [name] wearing [sprite], or finds nothing when [name] is null.
     *
     * One MockEngine serves both calls a refresh makes, told apart by host: the ranking JSON from
     * nexon.com, and the image from anywhere else.
     */
    private fun job(
        name: String?,
        sprite: String = newUrl,
    ): SpriteRefreshJob {
        val ranking =
            if (name == null) {
                """{"totalCount":0,"ranks":[]}"""
            } else {
                """{"totalCount":1,"ranks":[{"characterName":"$name","level":296,""" +
                    """"jobName":"Night Lord","characterImgURL":"$sprite"}]}"""
            }
        val engine =
            MockEngine { request ->
                if (request.url.host == "www.nexon.com") {
                    respond(ranking, HttpStatusCode.OK, headersOf(HttpHeaders.ContentType, "application/json"))
                } else {
                    respond(
                        png,
                        HttpStatusCode.OK,
                        headersOf(HttpHeaders.ContentType, ContentType.Image.PNG.toString()),
                    )
                }
            }
        val client = HttpClient(engine) { install(ContentNegotiation) { json(Json { ignoreUnknownKeys = true }) } }
        return SpriteRefreshJob(NexonLookupService(client), SpriteCache(client))
    }

    private fun stored(due: SpriteRefreshJob.Due) =
        transaction { Characters.selectAll().where { Characters.id eq due.id }.single() }

    /** Whether the daily query would pick this character up right now. */
    private fun isDue(due: SpriteRefreshJob.Due): Boolean =
        transaction {
            // Int.MAX_VALUE, not the real batch size: this asks "would it be selected", and a batch
            // of 20 would make the answer depend on how many other characters the database holds.
            job(null).dueCharacters(Clock.System.now(), limit = Int.MAX_VALUE).any { it.id == due.id }
        }

    @Test
    fun `a character asked about today is not due`() {
        assertFalse(isDue(character(checkedAgo = 2.hours)))
    }

    @Test
    fun `a character not asked about for a day is due`() {
        assertTrue(isDue(character(checkedAgo = 2.days)))
    }

    @Test
    fun `a character never asked about is due`() {
        // Null rather than old: a character added when the lookup found nothing has no answer and no
        // ask recorded, and is exactly the one worth trying again.
        assertTrue(isDue(character(checkedAgo = null)))
    }

    @Test
    fun `a refresh takes the new outfit and warms its bytes`() {
        val due = character(checkedAgo = 2.days)
        runBlocking { job("refreshtest").refresh(due, Clock.System.now()) }

        val row = stored(due)
        assertEquals(newUrl, row[Characters.spriteImgUrl])
        // The bytes for the NEW url, warmed in the same pass. Without this the day's refresh would
        // have moved the URL without moving the cache, and the first request for the new path would
        // redirect to Nexon.
        assertNotNull(transaction { cachedSprite(spriteKey(newUrl)) }?.image)
        assertFalse(isDue(due), "a character just refreshed must not still be due")
    }

    @Test
    fun `a name that no longer ranks keeps its sprite and stops being re-asked`() {
        val due = character(checkedAgo = 2.days)
        val before = stored(due)[Characters.spriteRefreshedAt]

        runBlocking { job(null).refresh(due, Clock.System.now()) }

        val row = stored(due)
        // The good data survives. It is far likelier that Nexon had a bad minute than that the
        // character stopped existing, and blanking it would empty the roster over an outage.
        assertEquals(oldUrl, row[Characters.spriteImgUrl])
        assertEquals(before, row[Characters.spriteRefreshedAt])

        // But the ask is recorded, which is the whole reason the two columns are separate. Without
        // it this character comes back in every batch for the rest of time.
        assertRecent(assertNotNull(row[Characters.spriteCheckedAt]))
        assertFalse(isDue(due), "an unresolvable name must not be re-asked on the next tick")
    }

    @Test
    fun `a lookup answering about somebody else is ignored`() {
        // The ranking endpoint truncates the name to 12 characters before matching, so a longer name
        // answers with whoever owns its first 12 (see NexonLookupService). This pins that the refresh
        // inherits that refusal rather than writing another player's outfit onto this character.
        val due = character(checkedAgo = 2.days, name = "refreshtestlongname")
        runBlocking { job("refreshtestl").refresh(due, Clock.System.now()) }

        assertEquals(oldUrl, stored(due)[Characters.spriteImgUrl])
        assertNull(transaction { cachedSprite(spriteKey(newUrl)) })
    }

    // runOnce() itself is deliberately not tested. It is dueCharacters() and refresh() in a loop,
    // both covered above, and exercising it against the shared dev database would stamp
    // sprite_checked_at on the developer's real characters, quietly postponing their next real
    // refresh by a day.

    private fun assertRecent(instant: Instant) {
        val age = Clock.System.now() - instant
        assertTrue(age < 1.hours, "expected a timestamp from this run, was $age old")
    }
}
