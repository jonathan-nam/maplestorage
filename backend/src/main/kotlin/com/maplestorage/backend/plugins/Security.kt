package com.maplestorage.backend.plugins

import com.auth0.jwk.JwkProviderBuilder
import com.auth0.jwt.interfaces.Verification
import com.maplestorage.backend.config.Env
import io.ktor.http.HttpHeaders
import io.ktor.http.auth.HttpAuthHeader
import io.ktor.server.application.Application
import io.ktor.server.application.install
import io.ktor.server.auth.Authentication
import io.ktor.server.auth.UnauthorizedResponse
import io.ktor.server.auth.jwt.JWTPrincipal
import io.ktor.server.auth.jwt.jwt
import io.ktor.server.response.respond
import java.net.URI
import java.util.concurrent.TimeUnit

const val CLERK_AUTH = "clerk-jwt"

private const val MILLIS_PER_SECOND = 1000L
private const val JWK_CACHE_SIZE = 10L
private const val JWK_CACHE_EXPIRY_HOURS = 24L
private const val JWK_RATE_LIMIT_BUCKET_SIZE = 10L
private const val JWK_RATE_LIMIT_REFILL_MINUTES = 1L

// Tolerance on `exp`, because our clock and Clerk's are never quite identical. Zero of it turned a
// host running 50s fast into a wall of `expired-token` 401s on tokens that were still valid.
// 5s is @clerk/backend's own clockSkewInMs default, and has to stay far below the 60s token life
// or it silently lengthens every session. Bracketed by SecurityTest.
private const val CLOCK_LEEWAY_SECONDS = 5L

/**
 * What we check on a Clerk token beyond its signature.
 *
 * Split out from the plugin so a test can exercise it without standing up an Application and a
 * JWKS endpoint.
 */
internal fun Verification.clerkClaims() {
    // Clerk's default JWT template omits an `aud` claim unless a custom template adds one. Nothing
    // to check here beyond signature and expiry until/unless that changes.
    acceptLeeway(CLOCK_LEEWAY_SECONDS)
}

fun Application.configureSecurity() {
    val jwksUri = URI(Env.clerkJwksUrl).toURL()
    val jwkProvider =
        JwkProviderBuilder(jwksUri)
            .cached(JWK_CACHE_SIZE, JWK_CACHE_EXPIRY_HOURS, TimeUnit.HOURS)
            .rateLimited(JWK_RATE_LIMIT_BUCKET_SIZE, JWK_RATE_LIMIT_REFILL_MINUTES, TimeUnit.MINUTES)
            .build()

    install(Authentication) {
        jwt(CLERK_AUTH) {
            verifier(jwkProvider) { clerkClaims() }
            validate { credential ->
                // `sub` is the Clerk userId, this is what Users.id (see
                // PLAN.md's data model) is keyed on.
                if (credential.payload.subject != null) {
                    JWTPrincipal(credential.payload)
                } else {
                    null
                }
            }
            // Same 401 as the default challenge, plus the reason on the request's log line. See
            // AuthFailure.kt: which kind of 401 it is decides whose bug it is.
            challenge { scheme, realm ->
                call.failing(
                    authFailureReason(
                        call.request.headers[HttpHeaders.Authorization],
                        System.currentTimeMillis() / MILLIS_PER_SECOND,
                    ),
                )
                call.respond(
                    UnauthorizedResponse(
                        HttpAuthHeader.Parameterized(scheme, mapOf(HttpAuthHeader.Parameters.Realm to realm)),
                    ),
                )
            }
        }
    }
}
