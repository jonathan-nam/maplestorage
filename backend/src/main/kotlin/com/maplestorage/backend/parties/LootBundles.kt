package com.maplestorage.backend.parties

import com.maplestorage.backend.db.PartyLootBundle
import com.maplestorage.backend.plugins.parseUuidParam
import com.maplestorage.backend.plugins.principalIdAndEmail
import com.maplestorage.backend.users.ensureUser
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.call
import io.ktor.server.request.receive
import io.ktor.server.routing.RoutingContext
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import kotlin.uuid.Uuid

// Who picked up which stacks of a drop: the read, and PUT /{lootId}/bundles, registered by
// LootRoutes.kt. In its own file only because both of those files are at detekt's function ceiling.
//
// The one fact about a drop that cannot be worked out from anything else. Everyone takes
// floor(stacks / seats) and the remainder goes to somebody, and which somebody happened in the map.
// See V41__loot_bundles.sql.

/** Which seat picked up how many stacks, per drop. An absent drop is one nobody has answered for. */
internal fun bundlesFor(lootIds: List<Uuid>): Map<Uuid, List<LootBundleResponse>> =
    PartyLootBundle
        .selectAll()
        .where { PartyLootBundle.lootId inList lootIds }
        .groupBy({ it[PartyLootBundle.lootId] }) {
            LootBundleResponse(
                memberId = it[PartyLootBundle.memberId].toString(),
                bundles = it[PartyLootBundle.bundles],
            )
        }

/**
 * Records who picked up which stacks of a drop.
 *
 * No default is written here or anywhere else. The best guess is whoever is furthest behind, which
 * reads off a running balance that moves whenever an earlier week is edited, so a stored guess would
 * rewrite who owed what on nights already settled. An unanswered drop stays unanswered.
 */
internal suspend fun RoutingContext.setBundlesRoute() {
    val (userId, email) = call.principalIdAndEmail()
    val partyId = call.parseUuidParam("id") ?: return
    val lootId = call.parseUuidParam("lootId") ?: return
    val request = call.receive<LootBundlesRequest>()

    val outcome =
        transaction {
            ensureUser(userId, email)
            val loot = findLoot(lootId, partyId)
            when {
                !ownsParty(partyId, userId) -> null
                loot == null -> null
                request.bundles.keys.any { Uuid.parseOrNull(it) == null } -> "malformed memberId"
                bundlesRefusal(request.bundles, loot.ranThatWeek, loot.bundles) != null ->
                    bundlesRefusal(request.bundles, loot.ranThatWeek, loot.bundles)
                else -> {
                    setLootBundles(lootId, request.bundles.mapKeys { Uuid.parse(it.key) })
                    findLoot(lootId, partyId)!!
                }
            }
        }
    respondToLoot(outcome, HttpStatusCode.OK)
}
