package com.maplestorage.backend.plugins

import com.maplestorage.backend.characters.characterRoutes
import com.maplestorage.backend.screenshots.screenshotRoutes
import com.maplestorage.backend.services.NexonLookupService
import com.maplestorage.backend.services.ScreenshotParser
import com.maplestorage.backend.tokens.tokenRoutes
import io.ktor.server.application.Application
import io.ktor.server.application.call
import io.ktor.server.auth.authenticate
import io.ktor.server.auth.jwt.JWTPrincipal
import io.ktor.server.auth.principal
import io.ktor.server.http.content.staticResources
import io.ktor.server.response.respond
import io.ktor.server.routing.get
import io.ktor.server.routing.route
import io.ktor.server.routing.routing
import org.jetbrains.exposed.v1.jdbc.transactions.transaction

fun Application.configureRouting(
    nexonLookupService: NexonLookupService,
    screenshotParser: ScreenshotParser,
) {
    routing {
        // Token icons are the seeded catalog images (token_catalog.icon_ref_key
        // is the bare filename). Public on purpose -- they're static art, and
        // the <img> tags that load them can't attach a Bearer token.
        staticResources("/token-icons", "seed-assets/tokens")

        // The stack-count digits, as the CLIENT draws them -- the very same glyph sprites the
        // parser reads counts with (vision/app/cv/templates/digit_*.png). The inventory renders
        // its counts from these rather than setting a number in a web font, because no web font
        // is that font: it is an 11px bitmap face with a hard black outline, and any approximation
        // of it sits next to the real sprites and looks like an approximation.
        staticResources("/digit-icons", "seed-assets/digits")

        // Unauthenticated on purpose -- this is what the ALB target group polls
        // (see infra/alb.tf's health_check block). No DB touch here: a slow or
        // briefly-unavailable RDS shouldn't flip the target group unhealthy.
        get("/health") {
            call.respond(mapOf("status" to "ok"))
        }

        // M0's actual round-trip proof: a signed-in user's JWT verifies against
        // Clerk's JWKS, and the response value comes from a real RDS query, not
        // a hardcoded string.
        authenticate(CLERK_AUTH) {
            get("/api/ping") {
                val principal = call.principal<JWTPrincipal>()
                val userId = principal!!.payload.subject

                val dbTimestamp =
                    transaction {
                        exec("SELECT NOW()") { rows ->
                            rows.next()
                            rows.getString(1)
                        }
                    }

                call.respond(PingResponse(userId = userId, dbTimestamp = dbTimestamp ?: "unknown"))
            }

            route("/api/characters") {
                characterRoutes(nexonLookupService)
            }

            route("/api/screenshots") {
                screenshotRoutes(screenshotParser)
            }

            route("/api/tokens") {
                tokenRoutes()
            }
        }
    }
}
