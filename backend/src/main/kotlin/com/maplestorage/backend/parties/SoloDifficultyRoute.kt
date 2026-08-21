package com.maplestorage.backend.parties

import com.maplestorage.backend.plugins.principalIdAndEmail
import com.maplestorage.backend.users.ensureUser
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.call
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.RoutingContext
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import kotlin.time.Clock
import kotlin.uuid.Uuid

// One route, in a file of its own, as the drop log's is. See LootLogRoute.kt.

/**
 * Records which mode this character runs a boss at alone, and files what the clear then guarantees.
 *
 * By character and boss rather than by config id, like the Drop Log's own route: the pool may not
 * exist yet, and naming the mode is what opens it.
 *
 * Solo only. A boss this character has a STANDING party for keeps its mode on that config, beside the
 * roster and the split it is read with, and writing one from here would edit a party through a door
 * that can see neither. A retired config claims nothing about now, so it is taken back as a pool
 * rather than refused over: see setSoloDifficulty.
 */
internal suspend fun RoutingContext.setSoloDifficultyRoute() {
    val (userId, email) = call.principalIdAndEmail()
    val request = call.receive<SetSoloDifficultyRequest>()
    val characterId =
        Uuid.parseOrNull(request.characterId)
            ?: return call.respond(HttpStatusCode.BadRequest, "malformed characterId")

    val outcome =
        transaction {
            ensureUser(userId, email)
            val bossId = bossIdForKey(request.bossKey)
            when {
                // Ownership first, as createPartyRoute does: the pair lookup setSoloDifficulty runs
                // does not filter by user, so somebody else's character must not reach a config
                // through it.
                !ownsCharacter(characterId, userId) -> "characterId must be one of your characters"
                bossId == null -> "unknown bossKey"
                else ->
                    validateDifficulty(bossId, request.difficulty) ?: run {
                        // Non-null by the catalog row the boss id came out of.
                        val reset = bossResetOf(bossId)!!
                        val partyId =
                            setSoloDifficulty(
                                userId,
                                characterId,
                                bossId,
                                reset,
                                request.difficulty,
                                Clock.System.now(),
                            )
                        if (partyId == null) {
                            "that boss has a party; its difficulty is on the party"
                        } else {
                            findParty(partyId, userId)!!
                        }
                    }
            }
        }
    respondToSave(outcome, HttpStatusCode.OK)
}
