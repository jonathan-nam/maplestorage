package com.maplestorage.backend.plugins

import com.auth0.jwk.JwkProviderBuilder
import com.maplestorage.backend.config.Env
import io.ktor.server.application.Application
import io.ktor.server.application.install
import io.ktor.server.auth.Authentication
import io.ktor.server.auth.jwt.JWTPrincipal
import io.ktor.server.auth.jwt.jwt
import java.net.URI
import java.util.concurrent.TimeUnit

const val CLERK_AUTH = "clerk-jwt"

private const val JWK_CACHE_SIZE = 10L
private const val JWK_CACHE_EXPIRY_HOURS = 24L
private const val JWK_RATE_LIMIT_BUCKET_SIZE = 10L
private const val JWK_RATE_LIMIT_REFILL_MINUTES = 1L

fun Application.configureSecurity() {
    val jwksUri = URI(Env.clerkJwksUrl).toURL()
    val jwkProvider =
        JwkProviderBuilder(jwksUri)
            .cached(JWK_CACHE_SIZE, JWK_CACHE_EXPIRY_HOURS, TimeUnit.HOURS)
            .rateLimited(JWK_RATE_LIMIT_BUCKET_SIZE, JWK_RATE_LIMIT_REFILL_MINUTES, TimeUnit.MINUTES)
            .build()

    install(Authentication) {
        jwt(CLERK_AUTH) {
            verifier(jwkProvider) {
                // Clerk's default JWT template omits an `aud` claim unless a
                // custom template adds one -- nothing to check here beyond
                // signature + expiry until/unless that changes.
            }
            validate { credential ->
                // `sub` is the Clerk userId -- this is what Users.id (see
                // PLAN.md's data model) is keyed on.
                if (credential.payload.subject != null) {
                    JWTPrincipal(credential.payload)
                } else {
                    null
                }
            }
        }
    }
}
