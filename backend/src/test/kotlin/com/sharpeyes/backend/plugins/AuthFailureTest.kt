package com.sharpeyes.backend.plugins

import java.util.Base64
import kotlin.test.Test
import kotlin.test.assertEquals

// A 401 is one status covering several different bugs, and the log could not tell them apart.
// These pin the names down, because the names are what a future incident gets grepped by.
class AuthFailureTest {
    private val now = 1_700_000_000L

    private fun jwt(expiry: Long?): String {
        val encoder = Base64.getUrlEncoder().withoutPadding()
        val header = encoder.encodeToString("""{"alg":"RS256","kid":"k"}""".toByteArray())
        val claims = if (expiry == null) """{"sub":"user_1"}""" else """{"sub":"user_1","exp":$expiry}"""
        return "$header.${encoder.encodeToString(claims.toByteArray())}.signature"
    }

    @Test
    fun `no header at all`() {
        assertEquals("no-header", authFailureReason(null, now))
    }

    @Test
    fun `a scheme that is not Bearer`() {
        assertEquals("not-bearer", authFailureReason("Basic dXNlcjpwYXNz", now))
    }

    @Test
    fun `Bearer with nothing after it`() {
        assertEquals("empty-token", authFailureReason("Bearer ", now))
    }

    // The one this was written for. A template literal interpolated a token that had not arrived
    // yet, so `Bearer null` went out and 45 requests 401'd in a way nobody could attribute.
    @Test
    fun `the string null is the client's bug, not an expired token`() {
        assertEquals("null-token", authFailureReason("Bearer null", now))
        assertEquals("null-token", authFailureReason("Bearer undefined", now))
    }

    @Test
    fun `something that is not a JWT at all`() {
        assertEquals("malformed-token", authFailureReason("Bearer abc.def", now))
    }

    @Test
    fun `a real token past its expiry`() {
        assertEquals("expired-token", authFailureReason("Bearer ${jwt(now - 1)}", now))
    }

    // Still in date, so the verifier turned it down for some other reason (signature, no `sub`).
    // Calling that "expired" would send the next reader after a clock problem that is not there.
    @Test
    fun `an unexpired token the verifier refused`() {
        assertEquals("rejected-token", authFailureReason("Bearer ${jwt(now + 60)}", now))
    }

    @Test
    fun `a token carrying no expiry claim`() {
        assertEquals("rejected-token", authFailureReason("Bearer ${jwt(null)}", now))
    }

    // Reading the payload must never decide anything, so a payload that will not decode is simply
    // not expired rather than an exception on the rejection path.
    @Test
    fun `an undecodable payload does not throw`() {
        assertEquals("rejected-token", authFailureReason("Bearer aaa.!!!!.ccc", now))
    }
}
