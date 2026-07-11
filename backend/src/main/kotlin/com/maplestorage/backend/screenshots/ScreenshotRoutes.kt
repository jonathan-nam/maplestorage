package com.maplestorage.backend.screenshots

import com.maplestorage.backend.characters.findOwnedCharacter
import com.maplestorage.backend.plugins.parseUuidParam
import com.maplestorage.backend.plugins.principalIdAndEmail
import com.maplestorage.backend.services.ClaudeVisionService
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.call
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.RoutingContext
import io.ktor.server.routing.post
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import kotlin.uuid.Uuid

fun Route.screenshotRoutes(
    claudeVisionService: ClaudeVisionService,
    anthropicModel: String,
) {
    post { uploadScreenshot(claudeVisionService, anthropicModel) }
    post("/{id}/resolve") { resolveScreenshotRoute() }
    post("/{id}/ignore") { ignoreScreenshotRoute() }
}

private suspend fun RoutingContext.uploadScreenshot(
    claudeVisionService: ClaudeVisionService,
    anthropicModel: String,
) {
    val (userId, email) = call.principalIdAndEmail()
    val request = call.receive<UploadScreenshotRequest>()

    val pinnedCharacterId = request.characterId?.let { Uuid.parseOrNull(it) }
    if (request.characterId != null && pinnedCharacterId == null) {
        call.respond(HttpStatusCode.BadRequest, "malformed characterId")
        return
    }
    // Ownership check before spending a Claude call on a request that would
    // 404 anyway -- also stops a screenshot from ever getting attributed
    // under another user's guessed/stolen character id.
    if (pinnedCharacterId != null) {
        val owned = transaction { findOwnedCharacter(pinnedCharacterId, userId) }
        if (owned == null) {
            call.respond(HttpStatusCode.NotFound)
            return
        }
    }

    val result =
        ingestScreenshot(
            userId = userId,
            email = email,
            request = request,
            pinnedCharacterId = pinnedCharacterId,
            claudeVisionService = claudeVisionService,
            model = anthropicModel,
        )
    call.respond(result)
}

private suspend fun RoutingContext.resolveScreenshotRoute() {
    val (userId, _) = call.principalIdAndEmail()
    val screenshotId = call.parseUuidParam("id") ?: return
    val request = call.receive<ResolveScreenshotRequest>()
    val newCharacterId =
        Uuid.parseOrNull(request.characterId) ?: run {
            call.respond(HttpStatusCode.BadRequest, "malformed characterId")
            return
        }

    val resolved = resolveScreenshot(userId, screenshotId, newCharacterId)
    if (resolved) {
        call.respond(HttpStatusCode.NoContent)
    } else {
        call.respond(HttpStatusCode.NotFound)
    }
}

private suspend fun RoutingContext.ignoreScreenshotRoute() {
    val (userId, _) = call.principalIdAndEmail()
    val screenshotId = call.parseUuidParam("id") ?: return

    if (ignoreScreenshot(userId, screenshotId)) {
        call.respond(HttpStatusCode.NoContent)
    } else {
        call.respond(HttpStatusCode.NotFound)
    }
}
