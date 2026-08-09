package com.maplestorage.backend.parties

import com.maplestorage.backend.plugins.parseUuidParam
import com.maplestorage.backend.plugins.principalIdAndEmail
import com.maplestorage.backend.users.ensureUser
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.call
import io.ktor.server.request.receive
import io.ktor.server.routing.RoutingContext
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import kotlin.time.Clock
import kotlin.uuid.Uuid

// PUT /api/parties/{id}/loot/{lootId}/taken. Registered by LootRoutes.kt with the rest of the pool.
//
// In its own file the way LotSaleRoute.kt is: this is the whole of what a Heroic pool does, and the
// reasoning behind the refusal is longer than the handler.

/**
 * Who took this drop, in a world that cannot sell it. A null memberId puts it back in the pool.
 *
 * Refused where the party CAN sell, which is not a technicality. In a trading world a drop that
 * changes hands is a sale, with a pot and a roster owed a share of it, and letting it be recorded
 * here instead would take that drop off the pending list with nobody owed anything: a party that
 * quietly stopped being paid, which is exactly the silent wrong number this app exists to prevent.
 */
internal suspend fun RoutingContext.setTakenRoute() {
    val (userId, email) = call.principalIdAndEmail()
    val partyId = call.parseUuidParam("id") ?: return
    val lootId = call.parseUuidParam("lootId") ?: return
    val request = call.receive<TakenRequest>()
    val memberId = request.memberId?.let { Uuid.parseOrNull(it) }

    val outcome =
        transaction {
            ensureUser(userId, email)
            val loot = findLoot(lootId, partyId)
            when {
                !ownsParty(partyId, userId) -> null
                loot == null -> null
                else ->
                    // Against the drop's own ranThatWeek, which is the same list the picker offers,
                    // so what is accepted and what is offered cannot disagree. An id that will not
                    // parse is passed through rather than nulled: it names somebody, just nobody who
                    // exists, and nulling it would read as "put it back" and quietly succeed.
                    takenRefusal(
                        memberId?.toString() ?: request.memberId,
                        loot.ranThatWeek,
                        partyCanSell(partyId),
                        loot.soldAt != null,
                    ) ?: run {
                        setLootTakenBy(lootId, memberId, Clock.System.now())
                        findLoot(lootId, partyId)!!
                    }
            }
        }
    respondToLoot(outcome, HttpStatusCode.OK)
}
