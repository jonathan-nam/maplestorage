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
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.neq
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import org.jetbrains.exposed.v1.jdbc.update

// The account's own settings. Mirrored by the frontend's types/settings.ts field-for-field.

@Serializable
data class SettingsResponse(
    // INTERACTIVE or HEROIC: the world the site is currently answering for. See activeWorldFor.
    val worldType: String,
    // Whether anything in the world being shown can change hands. Every meso figure hangs off it.
    val trades: Boolean,
    // How many characters the OTHER world holds.
    //
    // The one thing a mode cannot leave unsaid. Narrowing to one world hides the rest of the
    // account by design, and a screen that is empty because you are standing in the wrong world
    // looks exactly like a screen that is empty because you have nothing.
    val otherWorldCharacters: Int,
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

internal fun settingsFor(userId: String): SettingsResponse {
    val world = activeWorldFor(userId)
    val elsewhere =
        Characters
            .selectAll()
            .where { (Characters.userId eq userId) and (Characters.worldType neq world) }
            .count()
            .toInt()
    return SettingsResponse(
        worldType = world,
        trades = world == WORLD_INTERACTIVE,
        otherWorldCharacters = elsewhere,
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

    val settings =
        transaction {
            ensureUser(userId, email)
            setActiveWorld(userId, worldType)
            settingsFor(userId)
        }

    call.respond(settings)
}

/**
 * Point the site at a world. Moves no character, which is the whole rule.
 *
 * This used to set every character's world too, back when it was a "Set all" button. Under a toggle
 * that is the worst thing it could do: flipping to Reboot to look at your Reboot characters would
 * convert your Interactive ones on the way, silently, and their parties would stop being able to
 * sell what they had already sold. Pinned by a test.
 */
internal fun setActiveWorld(
    userId: String,
    world: String,
) {
    Users.update({ Users.id eq userId }) { it[worldType] = world }
}
