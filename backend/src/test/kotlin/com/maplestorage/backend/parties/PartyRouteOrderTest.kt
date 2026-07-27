package com.maplestorage.backend.parties

import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.client.statement.bodyAsText
import io.ktor.server.response.respond
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.route
import io.ktor.server.routing.routing
import io.ktor.server.testing.testApplication
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * /api/parties/loot has to reach the wallet's handler, not the one for /api/parties/{id}.
 *
 * Ktor scores a constant segment above a parameter, so it does. That is a framework rule this
 * route tree leans on, and its breakage would be silent in the worst way: the id handler would
 * answer "malformed id" for a path that is not an id, and the wallet would look like a bad
 * request. Pinned here rather than trusted, because the real routes cannot be probed for it
 * (authentication answers 401 whichever handler would have run).
 *
 * The paths are PartyRoutes.kt's, and must be kept the same as its.
 */
class PartyRouteOrderTest {
    @Test
    fun `a constant segment wins over the id parameter beside it`() =
        testApplication {
            application {
                routing {
                    // Declared in the order PartyRoutes.kt declares them.
                    get("/parties/loot") { call.respond("all pools") }
                    post("/parties/loot/settle") { call.respond("settle") }
                    get("/parties/{id}") { call.respond("one party: ${call.parameters["id"]}") }
                    route("/parties/{id}/loot") { get { call.respond("one pool") } }
                }
            }

            assertEquals("all pools", client.get("/parties/loot").bodyAsText())
            // The wallet's settle is three segments, and the two-segment /{id}/loot beside it must
            // not swallow the first two.
            assertEquals("settle", client.post("/parties/loot/settle").bodyAsText())
            // The neighbours still resolve to themselves.
            assertEquals("one party: abc", client.get("/parties/abc").bodyAsText())
            assertEquals("one pool", client.get("/parties/abc/loot").bodyAsText())
        }

    @Test
    fun `it wins from the other declaration order too`() =
        testApplication {
            application {
                routing {
                    get("/parties/{id}") { call.respond("one party") }
                    get("/parties/loot") { call.respond("all pools") }
                }
            }

            // Resolution is by score, not by the order the routes were registered in. Worth
            // pinning separately: an "obviously safe" reorder of PartyRoutes.kt would otherwise
            // be the thing that breaks it.
            assertEquals("all pools", client.get("/parties/loot").bodyAsText())
        }
}
