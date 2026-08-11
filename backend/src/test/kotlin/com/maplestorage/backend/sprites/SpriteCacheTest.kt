package com.maplestorage.backend.sprites

import com.maplestorage.backend.config.Env
import com.maplestorage.backend.db.CharacterSprite
import com.maplestorage.backend.db.Characters
import com.maplestorage.backend.users.WORLD_INTERACTIVE
import com.maplestorage.backend.users.ensureUser
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.engine.mock.respondError
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.runBlocking
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
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.time.Clock
import kotlin.time.Duration.Companion.days
import kotlin.uuid.Uuid

/**
 * What the byte cache will and will not store.
 *
 * The refusals are the interesting half. These bytes get served back under a year-long `immutable`
 * header, so anything stored wrong is stored wrong for a year, and an HTML error page behind a 200
 * is a thing this endpoint does.
 */
class SpriteCacheTest {
    private val userId = "user_test_sprite_cache"
    private val url = "https://msavatar1.nexon.net/Character/CACHETEST.png"
    private val png = byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3)

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
        val key = spriteKey(url)
        transaction {
            Characters.deleteWhere { Characters.userId eq owner }
            CharacterSprite.deleteWhere { CharacterSprite.urlSha256 eq key }
        }
    }

    private fun cacheServing(
        status: HttpStatusCode,
        body: ByteArray,
        contentType: ContentType = ContentType.Image.PNG,
    ): SpriteCache {
        val engine =
            MockEngine {
                if (status == HttpStatusCode.OK) {
                    respond(body, status, headersOf(HttpHeaders.ContentType, contentType.toString()))
                } else {
                    respondError(status)
                }
            }
        return SpriteCache(HttpClient(engine))
    }

    private fun storedRow() =
        transaction {
            CharacterSprite.selectAll().where { CharacterSprite.urlSha256 eq spriteKey(url) }.singleOrNull()
        }

    @Test
    fun `a png is fetched and stored under the hash of its url`() =
        runBlocking {
            val cache = cacheServing(HttpStatusCode.OK, png)
            val bytes = cache.fetch(url)
            assertContentEquals(png, bytes)

            transaction { cache.store(url, bytes) }
            val row = assertNotNull(storedRow())
            assertContentEquals(png, row[CharacterSprite.image])
            assertEquals(url, row[CharacterSprite.sourceUrl])
            assertNotNull(row[CharacterSprite.fetchedAt])
        }

    @Test
    fun `a 200 that is not a png is refused`() =
        runBlocking {
            // Their edge can answer 200 with an HTML error page. Storing that would put a broken
            // image behind a year-long immutable header, so the magic number decides, not the
            // content-type header, which is theirs to get wrong.
            val cache = cacheServing(HttpStatusCode.OK, "<html>nope</html>".toByteArray())
            assertNull(cache.fetch(url))
        }

    @Test
    fun `an error response is refused`() =
        runBlocking {
            assertNull(cacheServing(HttpStatusCode.NotFound, ByteArray(0)).fetch(url))
            assertNull(cacheServing(HttpStatusCode.ServiceUnavailable, ByteArray(0)).fetch(url))
        }

    @Test
    fun `something far too large to be a sprite is refused`() =
        runBlocking {
            // A sprite is ~3.4 KB. The cap is what stops one bad response putting a megabyte per row
            // in the database.
            val huge = png + ByteArray(600 * 1024)
            assertNull(cacheServing(HttpStatusCode.OK, huge).fetch(url))
        }

    @Test
    fun `a failed warm registers the url so the route can redirect`() =
        runBlocking {
            val cache = cacheServing(HttpStatusCode.ServiceUnavailable, ByteArray(0))
            val bytes = cache.fetch(url)
            transaction { cache.store(url, bytes) }

            // The row exists with no bytes, which is what tells the route to send the browser to
            // Nexon instead of answering 404. A failed warm must cost the caching, never the image.
            val row = assertNotNull(storedRow())
            assertNull(row[CharacterSprite.image])
            assertNull(row[CharacterSprite.fetchedAt])
            assertEquals(url, row[CharacterSprite.sourceUrl])

            val cached = assertNotNull(transaction { cachedSprite(spriteKey(url)) })
            assertNull(cached.image)
            assertEquals(url, cached.sourceUrl)
        }

    @Test
    fun `a later failed warm does not throw away bytes already held`() =
        runBlocking {
            val good = cacheServing(HttpStatusCode.OK, png)
            val goodBytes = good.fetch(url)
            transaction { good.store(url, goodBytes) }

            // The URL identifies the art, so bytes we hold are the right bytes for it. A warm that
            // fails afterwards has nothing better to offer and must not blank them: doing so would
            // turn a Nexon outage into every sprite in the app disappearing.
            val bad = cacheServing(HttpStatusCode.ServiceUnavailable, ByteArray(0))
            val badBytes = bad.fetch(url)
            transaction { bad.store(url, badBytes) }

            assertContentEquals(png, assertNotNull(storedRow())[CharacterSprite.image])
        }

    @Test
    fun `an unknown key is not in the cache at all`() {
        assertNull(transaction { cachedSprite(spriteKey("https://msavatar1.nexon.net/never-seen.png")) })
    }

    @Test
    fun `the sweep keeps referenced sprites and drops orphans past the grace period`() {
        val orphan = "https://msavatar1.nexon.net/Character/ORPHANED.png"
        val cache = cacheServing(HttpStatusCode.OK, png)
        val now = Clock.System.now()
        val longAgo = now - 30.days

        transaction {
            ensureUser(userId, "$userId@example.com")
            Characters.insert {
                it[id] = Uuid.random()
                it[Characters.userId] = this@SpriteCacheTest.userId
                it[name] = "spritecachetest"
                it[worldType] = WORLD_INTERACTIVE
                it[spriteImgUrl] = url
                it[createdAt] = now
                it[updatedAt] = now
                it[position] = 0
            }
            cache.store(url, png)
            cache.store(orphan, png)
            // Both rows are old enough to be swept. Only one is still pointed at.
            CharacterSprite.deleteWhere { CharacterSprite.urlSha256 eq spriteKey(orphan) }
            CharacterSprite.insert {
                it[urlSha256] = spriteKey(orphan)
                it[sourceUrl] = orphan
                it[image] = png
                it[fetchedAt] = longAgo
                it[createdAt] = longAgo
            }
        }

        val swept = transaction { sweepOrphanedSprites(now) }
        assertTrue(swept >= 1, "the orphan should have been swept, got $swept")
        assertNotNull(transaction { cachedSprite(spriteKey(url)) }, "a referenced sprite must survive")
        assertNull(transaction { cachedSprite(spriteKey(orphan)) })

        transaction { CharacterSprite.deleteWhere { CharacterSprite.urlSha256 eq spriteKey(orphan) } }
    }

    @Test
    fun `a fresh orphan is left alone`() {
        val cache = cacheServing(HttpStatusCode.OK, png)
        val now = Clock.System.now()
        // Nothing references it, but it was cached moments ago. Deleting at the moment of orphaning
        // would re-fetch on an outfit flipped back, and would throw the bytes away over a bug that
        // dropped a reference for a day.
        transaction { cache.store(url, png) }
        transaction { sweepOrphanedSprites(now) }
        assertNotNull(transaction { cachedSprite(spriteKey(url)) })
    }
}
