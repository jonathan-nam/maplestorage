package com.maplestorage.backend.parties

import com.maplestorage.backend.plugins.principalIdAndEmail
import com.maplestorage.backend.users.ensureUser
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.call
import io.ktor.server.response.respond
import io.ktor.server.routing.RoutingContext
import org.jetbrains.exposed.v1.jdbc.transactions.transaction

// One route, in a file of its own, as the skip's is. See PartySkipRoute.kt.

/**
 * The config a readable URL names: GET /api/parties/by/rune/lomien.
 *
 * Takes a uuid as its one segment too, which is what an older link carries and what a config whose
 * character shares a name emits. Either way this is the only read the page starts with: it needs the
 * id back before it can ask for the pool, so a slug that names nothing 404s rather than being
 * guessed at. See findPartyBySlug.
 */
internal suspend fun RoutingContext.getPartyBySlug() {
    val (userId, email) = call.principalIdAndEmail()
    val path = call.parameters.getAll("path").orEmpty()
    val party =
        transaction {
            ensureUser(userId, email)
            findPartyBySlug(path, userId)
        }
    if (party == null) call.respond(HttpStatusCode.NotFound) else call.respond(party)
}
