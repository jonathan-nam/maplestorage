package com.maplestorage.backend.sprites

import com.maplestorage.backend.config.Env
import com.maplestorage.backend.db.CharacterSprite
import com.maplestorage.backend.db.Characters
import com.maplestorage.backend.users.WORLD_INTERACTIVE
import com.maplestorage.backend.users.ensureUser
import org.flywaydb.core.Flyway
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.jdbc.Database
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.time.Clock
import kotlin.uuid.Uuid

/**
 * A sprite URL sitting on a row that the cache has never heard of.
 *
 * This is the regression the byte cache shipped with. The DTO builds a proxy path from any stored
 * URL without consulting the cache, so a URL nobody registered became a path the route answered 404
 * for, and the sprite vanished from the page. Every URL predating the cache was in that state: 14 of
 * 16 party seats on the dev database, which is every roster.
 *
 * The original tests all seeded `character_sprite` first, so none of them could see it. This one
 * starts from the opposite state, which is the one real data was actually in.
 */
class SpriteRegistrationTest {
    private val userId = "user_test_sprite_registration"
    private val strandedUrl = "https://msavatar1.nexon.net/Character/PREDATESTHECACHE.png"

    @BeforeTest
    fun migrate() {
        val jdbcUrl = "jdbc:postgresql://${Env.dbHost}:${Env.dbPort}/${Env.dbName}"
        Flyway
            .configure()
            .dataSource(jdbcUrl, Env.dbUsername, Env.dbPassword)
            .load()
            .migrate()
        Database.connect(jdbcUrl, driver = "org.postgresql.Driver", user = Env.dbUsername, password = Env.dbPassword)
        cleanUp()
    }

    @AfterTest
    fun cleanUp() {
        val owner = userId
        val keys = listOf(spriteKey(strandedUrl))
        transaction {
            Characters.deleteWhere { Characters.userId eq owner }
            CharacterSprite.deleteWhere { CharacterSprite.urlSha256 inList keys }
        }
    }

    /** A character carrying a sprite URL with no cache row, the state every pre-V53 row was in. */
    private fun strandedCharacter() {
        val now = Clock.System.now()
        transaction {
            ensureUser(userId, "$userId@example.com")
            Characters.insert {
                it[id] = Uuid.random()
                it[Characters.userId] = this@SpriteRegistrationTest.userId
                it[name] = "strandedsprite"
                it[worldType] = WORLD_INTERACTIVE
                it[spriteImgUrl] = strandedUrl
                it[spriteRefreshedAt] = now
                it[spriteCheckedAt] = now
                it[createdAt] = now
                it[updatedAt] = now
                it[position] = 0
            }
        }
    }

    @Test
    fun `an unregistered url is what a 404 looks like before it is registered`() {
        strandedCharacter()
        // The failure itself, stated so the fix has something to be a fix OF. The DTO is already
        // handing out spriteProxyPath(strandedUrl) at this point, and the route has no row for it.
        assertNull(transaction { cachedSprite(spriteKey(strandedUrl)) })
    }

    @Test
    fun `registering a stranded url makes it resolve, without bytes`() {
        strandedCharacter()
        val registered = transaction { registerUnknownSprites() }
        assertEquals(true, registered >= 1, "expected the stranded url to be registered, got $registered")

        val cached = assertNotNull(transaction { cachedSprite(spriteKey(strandedUrl)) })
        assertEquals(strandedUrl, cached.sourceUrl)
        // No bytes: a migration and a query cannot make an outbound call. Null is the state the route
        // redirects to Nexon for, so the image is drawn now and cached when the refresh reaches it.
        assertNull(cached.image)
    }

    @Test
    fun `registering twice is a no-op`() {
        strandedCharacter()
        transaction { registerUnknownSprites() }
        // Runs every tick, so it has to be idempotent. Counting only what it newly registered is also
        // what keeps the log quiet once there is nothing stranded.
        assertEquals(0, transaction { registerUnknownSprites() })
    }

    @Test
    fun `registering does not disturb bytes already held`() {
        strandedCharacter()
        val png = byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 5)
        val now = Clock.System.now()
        transaction {
            CharacterSprite.insert {
                it[urlSha256] = spriteKey(strandedUrl)
                it[sourceUrl] = strandedUrl
                it[image] = png
                it[fetchedAt] = now
                it[createdAt] = now
            }
        }

        transaction { registerUnknownSprites() }
        assertEquals(png.size, transaction { cachedSprite(spriteKey(strandedUrl)) }?.image?.size)
    }

    @Test
    fun `the migration hashes a url the same way spriteKey does`() {
        // V54 backfills with postgres encode(sha256(url::bytea),'hex') while everything else uses
        // spriteKey(). If those ever disagree the backfill registers rows under keys no route will
        // ever ask for, and every sprite predating the cache stays a 404 with nothing to show why.
        val sql =
            transaction {
                exec("SELECT encode(sha256('$strandedUrl'::bytea), 'hex')") { rows ->
                    rows.next()
                    rows.getString(1)
                }
            }
        assertEquals(spriteKey(strandedUrl), sql)
    }
}
