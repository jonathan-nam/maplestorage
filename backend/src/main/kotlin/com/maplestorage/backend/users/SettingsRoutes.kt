package com.maplestorage.backend.users

import com.maplestorage.backend.db.Characters
import com.maplestorage.backend.db.Users
import com.maplestorage.backend.plugins.principalIdAndEmail
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.call
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.RoutingContext
import io.ktor.server.routing.get
import io.ktor.server.routing.put
import kotlinx.serialization.Serializable
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import org.jetbrains.exposed.v1.jdbc.update

// The account's own settings. Mirrored by the frontend's types/settings.ts field-for-field.

@Serializable
data class SettingsResponse(
    // INTERACTIVE or HEROIC.
    val worldType: String,
)

@Serializable
data class SaveSettingsRequest(
    val worldType: String,
)

fun Route.settingsRoutes() {
    get { getSettings() }
    put { saveSettings() }
}

private suspend fun RoutingContext.getSettings() {
    val (userId, email) = call.principalIdAndEmail()
    val settings =
        transaction {
            ensureUser(userId, email)
            Users
                .selectAll()
                .where { Users.id eq userId }
                .single()
                .let { SettingsResponse(worldType = it[Users.worldType]) }
        }
    call.respond(settings)
}

private suspend fun RoutingContext.saveSettings() {
    val (userId, email) = call.principalIdAndEmail()
    val request = call.receive<SaveSettingsRequest>()
    val worldType = worldTypeOrNull(request.worldType)
    if (worldType == null) {
        call.respond(HttpStatusCode.BadRequest, "worldType must be INTERACTIVE or HEROIC")
        return
    }

    transaction {
        ensureUser(userId, email)
        Users.update({ Users.id eq userId }) { it[Users.worldType] = worldType }
        // Every character follows the account, because nothing offers to set one separately yet.
        // The column is still the one parties read, so the day it is offered, only the UI changes.
        Characters.update({ Characters.userId eq userId }) { it[Characters.worldType] = worldType }
    }

    call.respond(SettingsResponse(worldType = worldType))
}
