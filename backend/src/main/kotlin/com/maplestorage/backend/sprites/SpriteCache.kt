package com.maplestorage.backend.sprites

import com.maplestorage.backend.db.CharacterSprite
import io.ktor.client.HttpClient
import io.ktor.client.request.get
import io.ktor.client.statement.bodyAsBytes
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.withTimeout
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.jdbc.insertIgnore
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.upsert
import kotlin.time.Clock

private const val FETCH_TIMEOUT_MS = 5_000L

// A sprite measured 3.4 KB. Two orders of magnitude of headroom, and a bound on what one bad
// response can put in the database.
private const val MAX_SPRITE_BYTES = 512 * 1024

// PNG's 8-byte file signature (RFC 2083 section 3.1). Written as hex so the bytes read as the
// signature rather than as eight unexplained numbers.
private val PNG_MAGIC = "89504e470d0a1a0a".hexToByteArray()

/** A cached sprite: the bytes if we have them, and the URL they came from either way. */
class CachedSprite(
    val sourceUrl: String,
    val image: ByteArray?,
)

/**
 * Fetches and stores the bytes behind a Nexon sprite URL.
 *
 * Populated on the way in, wherever a lookup hands back a sprite URL, rather than lazily on the
 * first request for one. That keeps the public route a pure database read: it can only serve URLs
 * Nexon already told us about, so it is not a lever for making this server fetch a URL of the
 * caller's choosing.
 */
class SpriteCache(
    private val client: HttpClient,
) {
    /**
     * The bytes at [url], or null if they could not be had.
     *
     * Never throws, for the same reason [com.maplestorage.backend.services.NexonLookupService] does
     * not: this is a cache warm, and failing it must not fail the character save that triggered it.
     */
    suspend fun fetch(url: String): ByteArray? =
        runCatching {
            val response = withTimeout(FETCH_TIMEOUT_MS) { client.get(url) }
            if (response.status != HttpStatusCode.OK) return null
            val bytes = response.bodyAsBytes()
            // A 200 carrying an HTML error page is a thing this endpoint does, and storing one would
            // put a broken image behind an `immutable` cache header. Checked by magic number rather
            // than content-type for the same reason: the header is theirs to get wrong.
            when {
                bytes.size > MAX_SPRITE_BYTES -> null
                !bytes.copyOfRange(0, minOf(PNG_MAGIC.size, bytes.size)).contentEquals(PNG_MAGIC) -> null
                else -> bytes
            }
        }.getOrNull()

    /**
     * Records [url] as a sprite this app serves, with [bytes] if the warm got them.
     *
     * Registering the URL even on a failed warm is what lets the route fall back to redirecting
     * there. Never downgrades a row that already has bytes: the URL identifies the art, so bytes we
     * already hold are the right bytes, and a later failed warm has nothing better to offer.
     *
     * Must be called from inside a `transaction { }` block.
     */
    fun store(
        url: String,
        bytes: ByteArray?,
    ) {
        val now = Clock.System.now()
        if (bytes == null) {
            // insertIgnore, and NOT an upsert whose update body is conditionally empty. An upsert
            // with nothing assigned in onUpdate falls through to updating every column in Exposed,
            // which blanked the bytes an earlier warm had already stored. A Nexon outage would then
            // have emptied the cache one failed warm at a time. See the test.
            CharacterSprite.insertIgnore {
                it[urlSha256] = spriteKey(url)
                it[sourceUrl] = url
                it[createdAt] = now
            }
            return
        }
        CharacterSprite.upsert(
            keys = arrayOf(CharacterSprite.urlSha256),
            onUpdate = {
                it[CharacterSprite.image] = bytes
                it[CharacterSprite.fetchedAt] = now
            },
        ) {
            it[urlSha256] = spriteKey(url)
            it[sourceUrl] = url
            it[image] = bytes
            it[fetchedAt] = now
            it[createdAt] = now
        }
    }
}

/**
 * The row for a proxy key, or null if this app has never been told about that URL.
 *
 * Must be called from inside a `transaction { }` block.
 */
fun cachedSprite(key: String): CachedSprite? =
    CharacterSprite
        .selectAll()
        .where { CharacterSprite.urlSha256 eq key }
        .singleOrNull()
        ?.let { CachedSprite(it[CharacterSprite.sourceUrl], it[CharacterSprite.image]) }
