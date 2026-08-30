package com.sharpeyes.backend.plugins

import com.auth0.jwt.JWT
import com.auth0.jwt.algorithms.Algorithm
import com.auth0.jwt.exceptions.TokenExpiredException
import java.util.Date
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

// `exp` is checked against OUR clock, and two machines never agree exactly. With no leeway at all a
// host running fast rejects tokens that have not expired, which is what a 50s-fast dev box did: the
// log said `expired-token` for credentials that were perfectly good.
//
// These bracket the leeway rather than assert the constant. Too little and that comes back, too
// much and a token quietly outlives what the auth service issued it for.
class SecurityTest {
    private val algorithm = Algorithm.HMAC256("test-secret")

    private val verifier = JWT.require(algorithm).apply { sessionClaims() }.build()

    private fun tokenExpiringIn(seconds: Long): String =
        JWT
            .create()
            .withSubject("user_1")
            .withExpiresAt(Date(System.currentTimeMillis() + seconds * MILLIS_PER_SECOND))
            .sign(algorithm)

    @Test
    fun `a token that expired two seconds ago is taken, because that is likely our clock`() {
        assertEquals("user_1", verifier.verify(tokenExpiringIn(-2)).subject)
    }

    @Test
    fun `a token that expired a minute ago is not`() {
        assertFailsWith<TokenExpiredException> { verifier.verify(tokenExpiringIn(-60)) }
    }

    private companion object {
        const val MILLIS_PER_SECOND = 1000L
    }
}
