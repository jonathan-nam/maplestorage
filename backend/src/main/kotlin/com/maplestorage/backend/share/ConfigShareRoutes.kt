package com.maplestorage.backend.share

import com.maplestorage.backend.plugins.principalIdAndEmail
import com.maplestorage.backend.users.ensureUser
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.call
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.RoutingContext
import io.ktor.server.routing.get
import org.jetbrains.exposed.v1.jdbc.transactions.transaction

// Handing an account's arrangements to somebody else, and reading one in. See ConfigShareDtos.kt
// for what does and does not cross.

fun Route.configShareRoutes() {
    get("/export") { exportRoute() }
}

private suspend fun RoutingContext.exportRoute() {
    val (userId, email) = call.principalIdAndEmail()
    val author = call.request.queryParameters["as"].orEmpty()

    val outcome =
        transaction {
            ensureUser(userId, email)
            validateExport(userId, author)
                ?: buildExport(userId, author).let { export ->
                    validateDocument(export.document) ?: export
                }
        }
    when (outcome) {
        is String -> call.respond(HttpStatusCode.BadRequest, outcome)
        else -> call.respond(outcome)
    }
}
