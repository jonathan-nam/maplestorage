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
import org.jetbrains.exposed.v1.jdbc.select
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import org.jetbrains.exposed.v1.jdbc.update

// The account's own settings. Mirrored by the frontend's types/settings.ts field-for-field.

@Serializable
data class SettingsResponse(
    // INTERACTIVE or HEROIC. What a newly added character starts in, and what "all characters"
    // last said. NOT an assertion about the account: a character's own world is the truth, and
    // one account can hold both.
    val worldType: String,
    // Whether ANY character is somewhere that trades.
    //
    // Derived, never stored, and the only thing the account-wide screens may key off: the section
    // menu and the Drop Log's meso totals answer for the whole account, and reading `worldType`
    // there would hide an Interactive character's real earnings behind a default nobody set.
    val trades: Boolean,
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
            settingsFor(userId)
        }
    call.respond(settings)
}

/**
 * An account with no characters yet trades, so a first-time page is not quietly missing half of
 * itself before there is anything to be missing.
 */
internal fun settingsFor(userId: String): SettingsResponse {
    val worlds =
        Characters
            .select(Characters.worldType)
            .where { Characters.userId eq userId }
            .map { it[Characters.worldType] }
    val default =
        Users
            .selectAll()
            .where { Users.id eq userId }
            .single()[Users.worldType]
    return SettingsResponse(
        worldType = default,
        trades = worlds.isEmpty() || worlds.any { it == WORLD_INTERACTIVE },
    )
}

private suspend fun RoutingContext.saveSettings() {
    val (userId, email) = call.principalIdAndEmail()
    val request = call.receive<SaveSettingsRequest>()
    val worldType = worldTypeOrNull(request.worldType)
    if (worldType == null) {
        call.respond(HttpStatusCode.BadRequest, "worldType must be INTERACTIVE or HEROIC")
        return
    }

    // The "all characters" control, which is also the only place the default is stated: saying it
    // of the whole account is the one unambiguous answer to what the next character starts in.
    // Setting a single character deliberately does NOT move it.
    val settings =
        transaction {
            ensureUser(userId, email)
            Users.update({ Users.id eq userId }) { it[Users.worldType] = worldType }
            Characters.update({ Characters.userId eq userId }) { it[Characters.worldType] = worldType }
            settingsFor(userId)
        }

    call.respond(settings)
}
