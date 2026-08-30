package com.sharpeyes.backend.sprites

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertNull

/**
 * The path is a pure function of the URL, and that is load-bearing in two directions.
 *
 * The DTO mappers build it without touching the database, so they can hand out a path for bytes that
 * have not been fetched yet. And the route serves `immutable` for a year on the strength of it: if
 * two different URLs could ever share a path, a year-long cache would be pinned to whichever art
 * arrived first.
 */
class SpriteProxyPathTest {
    private val url = "https://msavatar1.nexon.net/Character/ABCDEF.png"

    @Test
    fun `a url maps to a stable 64-hex path`() {
        // Pinned, not recomputed: sha256 of the URL string is the contract between the DTO and the
        // route, and a test that hashes it the same way the code does would agree with any change.
        assertEquals(
            "/character-sprites/3bb90c0857e55d5a2ad08ad64521a2e074ac79d978c53afeb28c72923ffdcd22.png",
            spriteProxyPath(url),
        )
        assertEquals(spriteProxyPath(url), spriteProxyPath(url))
    }

    @Test
    fun `a different outfit is a different path`() {
        // The point of keying on the URL. A new outfit is a new URL from Nexon, which has to become
        // a new path, or the immutable cache would keep serving the old art forever.
        assertNotEquals(spriteProxyPath(url), spriteProxyPath(url.replace("ABCDEF", "ABCDEG")))
    }

    @Test
    fun `only a 64-char lowercase hex segment is accepted`() {
        val key = spriteKey(url)
        assertEquals(key, spriteKeyFromSegment("$key.png"))
        assertEquals(key, spriteKeyFromSegment(key))

        // The segment reaches SQL, so anything that is not a key this service could have issued is
        // refused rather than looked up.
        assertNull(spriteKeyFromSegment(""))
        assertNull(spriteKeyFromSegment("../../etc/passwd"))
        assertNull(spriteKeyFromSegment("' OR 1=1 --"))
        assertNull(spriteKeyFromSegment(key.dropLast(1)))
        assertNull(spriteKeyFromSegment(key + "a"))
        assertNull(spriteKeyFromSegment(key.uppercase()))
        assertNull(spriteKeyFromSegment("z" + key.drop(1)))
    }
}
