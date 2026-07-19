package com.maplestorage.backend.bosses

import com.maplestorage.backend.plugins.principalIdAndEmail
import com.maplestorage.backend.users.ensureUser
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.RoutingContext
import io.ktor.server.routing.get
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import kotlin.time.Clock

fun Route.bossRoutes() {
    get { listBosses() }
    get("/clears") { getCurrentBossClears() }
}

// The catalog itself, in progression order. Served rather than shipped in the frontend so the
// matrix's columns come from catalog/bosses.yaml like everything else does, and adding a boss
// stays a one-file change.
internal suspend fun RoutingContext.listBosses() {
    val (userId, email) = call.principalIdAndEmail()
    val bosses =
        transaction {
            ensureUser(userId, email)
            bossCatalog()
        }
    call.respond(bosses)
}

internal suspend fun RoutingContext.getCurrentBossClears() {
    val (userId, email) = call.principalIdAndEmail()
    val clears =
        transaction {
            ensureUser(userId, email)
            currentBossClearsFor(userId, Clock.System.now())
        }
    call.respond(clears)
}
