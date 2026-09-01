package com.sharpeyes.backend.plugins

import io.ktor.http.HttpStatusCode
import io.ktor.server.application.ApplicationCall
import io.ktor.server.application.call
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import org.jetbrains.exposed.v1.jdbc.transactions.transaction

/**
 * Answers "could the app reach its database", for something watching from outside.
 *
 * Separate from /health on purpose. That one gates rolling deploys and deliberately touches no
 * table, so a slow query cannot stall one. The cost is that it answers "ok" with Postgres dead and
 * the site unusable, so an uptime check pointed at it stays green through the outage it was added
 * to catch. This is the endpoint to point a monitor at.
 *
 * Extracted from the route so both branches are testable. The 503 is the one that matters and it is
 * the one you cannot exercise by having a working database.
 */
suspend fun ApplicationCall.respondDbHealth(probe: () -> Boolean) {
    // Broad on purpose. The question is whether the database was reachable, and the ways it is not
    // are not one exception type: a refused socket, an exhausted Hikari pool and a killed backend
    // read differently and all mean the same thing here.
    @Suppress("TooGenericExceptionCaught")
    val reachable =
        try {
            probe()
        } catch (e: Exception) {
            failing("db unreachable: ${e.message}")
            false
        }

    if (reachable) {
        respond(mapOf("status" to "ok"))
    } else {
        respond(HttpStatusCode.ServiceUnavailable, mapOf("status" to "db unreachable"))
    }
}

/**
 * Both health endpoints, as one Route extension like every other route group here.
 *
 * Grouped mostly to keep configureRouting under detekt's LongMethod limit, which adding /health/db
 * inline pushed it past.
 */
fun Route.healthRoutes() {
    // Unauthenticated on purpose: deploy.sh polls it through nginx to decide when a restarted
    // replica may take traffic. It answers only once Flyway has migrated, which is the signal a
    // rolling deploy waits on, and it touches no table, so a slow query cannot stall one.
    get("/health") {
        call.respond(mapOf("status" to "ok"))
    }

    get("/health/db") {
        call.respondDbHealth { transaction { exec("SELECT 1") { rows -> rows.next() } } == true }
    }
}
