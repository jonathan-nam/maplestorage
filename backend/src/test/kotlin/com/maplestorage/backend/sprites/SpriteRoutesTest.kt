package com.maplestorage.backend.sprites

import com.maplestorage.backend.config.Env
import com.maplestorage.backend.db.CharacterSprite
import io.ktor.client.request.get
import io.ktor.client.statement.bodyAsBytes
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.server.routing.routing
import io.ktor.server.testing.testApplication
import org.flywaydb.core.Flyway
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.jdbc.Database
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.time.Clock

/**
 * The three states the proxy route can be in, and the header each one carries.
 *
 * The headers are the point of the change, not decoration. Nexon sends none at all (verified against
 * a live sprite URL on 2026-08-11: content-type, date and content-length, nothing else), which is why
 * every page load used to refetch every sprite.
 */
class SpriteRoutesTest {
    private val hit = "https://msavatar1.nexon.net/Character/ROUTEHIT.png"
    private val pending = "https://msavatar1.nexon.net/Character/ROUTEPENDING.png"
    private val png = byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 7, 7)

    @BeforeTest
    fun seed() {
        val jdbcUrl = "jdbc:postgresql://${Env.dbHost}:${Env.dbPort}/${Env.dbName}"
        Flyway
            .configure()
            .dataSource(jdbcUrl, Env.dbUsername, Env.dbPassword)
            .load()
            .migrate()
        Database.connect(jdbcUrl, driver = "org.postgresql.Driver", user = Env.dbUsername, password = Env.dbPassword)

        val now = Clock.System.now()
        cleanUp()
        transaction {
            CharacterSprite.insert {
                it[urlSha256] = spriteKey(hit)
                it[sourceUrl] = hit
                it[image] = png
                it[fetchedAt] = now
                it[createdAt] = now
            }
            CharacterSprite.insert {
                it[urlSha256] = spriteKey(pending)
                it[sourceUrl] = pending
                it[createdAt] = now
            }
        }
    }

    @AfterTest
    fun cleanUp() {
        val keys = listOf(spriteKey(hit), spriteKey(pending))
        transaction { CharacterSprite.deleteWhere { CharacterSprite.urlSha256 inList keys } }
    }

    @Test
    fun `cached bytes are served as an immutable png`() =
        testApplication {
            application { routing { spriteRoutes() } }

            val response = client.get(spriteProxyPath(hit))
            assertEquals(HttpStatusCode.OK, response.status)
            assertContentEquals(png, response.bodyAsBytes())
            assertEquals("image/png", response.headers[HttpHeaders.ContentType])

            // A year and immutable, which is only safe because the path is a hash of the source URL
            // and that URL encodes the outfit. A new outfit is a new path, so nothing can go stale
            // behind this header.
            val cacheControl = response.headers[HttpHeaders.CacheControl]
            assertEquals("public, max-age=31536000, immutable", cacheControl)
        }

    @Test
    fun `a known url with no bytes yet redirects to nexon and is not cached`() =
        testApplication {
            application { routing { spriteRoutes() } }
            // followRedirects would fire a real request at Nexon from a unit test.
            val response = createClient { followRedirects = false }.get(spriteProxyPath(pending))

            // The behaviour that predates this route, so a failed warm costs the caching and never
            // the image.
            assertEquals(HttpStatusCode.Found, response.status)
            assertEquals(pending, response.headers[HttpHeaders.Location])

            // no-store, or the redirect outlives the warm that lands a minute later and the browser
            // never comes back for the bytes.
            assertTrue(
                response.headers[HttpHeaders.CacheControl]?.contains("no-store") == true,
                "a redirect must not be cached, got ${response.headers[HttpHeaders.CacheControl]}",
            )
        }

    @Test
    fun `a url this app has never seen is not found`() =
        testApplication {
            application { routing { spriteRoutes() } }

            // Not a redirect and not a fetch. The route only ever serves URLs Nexon told us about, so
            // it cannot be used to make this server fetch a URL of the caller's choosing.
            val unknown = spriteProxyPath("https://msavatar1.nexon.net/Character/NEVERSEEN.png")
            assertEquals(HttpStatusCode.NotFound, client.get(unknown).status)
        }

    @Test
    fun `a segment that is not a key is not found`() =
        testApplication {
            application { routing { spriteRoutes() } }

            assertEquals(HttpStatusCode.NotFound, client.get("$SPRITE_PROXY_PREFIX/nonsense.png").status)
            assertEquals(HttpStatusCode.NotFound, client.get("$SPRITE_PROXY_PREFIX/${"a".repeat(64)}x.png").status)
        }
}
