package com.maplestorage.backend.parties

import com.maplestorage.backend.plugins.parseUuidParam
import com.maplestorage.backend.plugins.principalIdAndEmail
import com.maplestorage.backend.users.ensureUser
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.ApplicationCall
import io.ktor.server.application.call
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.RoutingContext
import io.ktor.server.routing.delete
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.put
import kotlinx.datetime.LocalDate
import kotlinx.datetime.TimeZone
import kotlinx.datetime.todayIn
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import kotlin.time.Clock
import kotlin.uuid.Uuid

// The loot pool, under an owned party: /api/parties/{id}/loot.
//
// Every handler starts by proving the party is the caller's. Nothing here trusts a loot id on its
// own, since a loot row's owner is its party's owner and nothing else.

fun Route.lootRoutes() {
    get { listLoot() }
    post { addLootRoute() }
    put("/{lootId}/sale") { sellLootRoute() }
    delete("/{lootId}/sale") { unsellLootRoute() }
    put("/{lootId}/payouts/{memberId}") { setPayoutRoute() }
    delete("/{lootId}") { deleteLootRoute() }
}

private suspend fun RoutingContext.listLoot() {
    val (userId, email) = call.principalIdAndEmail()
    val partyId = call.parseUuidParam("id") ?: return
    val loot =
        transaction {
            ensureUser(userId, email)
            if (!ownsParty(partyId, userId)) null else lootFor(partyId)
        }
    if (loot == null) call.respond(HttpStatusCode.NotFound) else call.respond(loot)
}

private suspend fun RoutingContext.addLootRoute() {
    val (userId, email) = call.principalIdAndEmail()
    val partyId = call.parseUuidParam("id") ?: return
    val request = call.receive<AddLootRequest>()

    // A malformed date is refused rather than replaced with today: a drop filed on the wrong day
    // is a row you cannot find again.
    val droppedOn =
        when (val raw = request.droppedOn) {
            null -> Clock.System.todayIn(TimeZone.UTC)
            else ->
                runCatching { LocalDate.parse(raw.trim()) }.getOrNull()
                    ?: return call.respond(HttpStatusCode.BadRequest, "malformed droppedOn, expected YYYY-MM-DD")
        }
    val customName = request.customName?.trim()?.ifBlank { null }

    val outcome =
        transaction {
            ensureUser(userId, email)
            val dropId = request.dropKey?.let { dropIdForKey(it) }
            val bossId = request.bossKey?.let { bossIdForKey(it) }
            when {
                !ownsParty(partyId, userId) -> null
                // Exactly one name. Both would leave two answers to "what is this?", neither
                // would leave a blank row.
                (request.dropKey == null) == (customName == null) ->
                    "send exactly one of dropKey or customName"
                request.dropKey != null && dropId == null -> "unknown dropKey"
                request.bossKey != null && bossId == null -> "unknown bossKey"
                else -> {
                    val lootId = addLoot(partyId, dropId, customName, bossId, droppedOn, Clock.System.now())
                    findLoot(lootId, partyId)!!
                }
            }
        }
    respondToLoot(outcome, HttpStatusCode.Created)
}

private suspend fun RoutingContext.sellLootRoute() {
    val (userId, email) = call.principalIdAndEmail()
    val partyId = call.parseUuidParam("id") ?: return
    val lootId = call.parseUuidParam("lootId") ?: return
    val request = call.receive<SellLootRequest>()
    val sellerId = Uuid.parseOrNull(request.sellerMemberId)

    val outcome =
        transaction {
            ensureUser(userId, email)
            when {
                !ownsParty(partyId, userId) -> null
                findLoot(lootId, partyId) == null -> null
                request.amount < 0 -> "amount must be zero or more"
                request.amountBasis !in AMOUNT_BASES -> "amountBasis must be LISTED or RECEIVED"
                request.splitMethod !in SPLIT_METHODS -> "splitMethod must be LAZY or FAIR"
                // The seller has to be a seat in THIS party: they are who the payouts are measured
                // against, and a stranger there would make every share wrong.
                sellerId == null || sellerId !in memberIdsOf(partyId) ->
                    "sellerMemberId must be a member of this party"
                else -> {
                    sellLoot(lootId, request, sellerId, partyId, Clock.System.now())
                    findLoot(lootId, partyId)!!
                }
            }
        }
    respondToLoot(outcome, HttpStatusCode.OK)
}

private suspend fun RoutingContext.unsellLootRoute() {
    val (userId, email) = call.principalIdAndEmail()
    val partyId = call.parseUuidParam("id") ?: return
    val lootId = call.parseUuidParam("lootId") ?: return

    val outcome =
        transaction {
            ensureUser(userId, email)
            when {
                !ownsParty(partyId, userId) -> null
                findLoot(lootId, partyId) == null -> null
                else -> {
                    unsellLoot(lootId, Clock.System.now())
                    findLoot(lootId, partyId)!!
                }
            }
        }
    respondToLoot(outcome, HttpStatusCode.OK)
}

private suspend fun RoutingContext.setPayoutRoute() {
    val (userId, email) = call.principalIdAndEmail()
    val ids = call.parseUuidParams("id", "lootId", "memberId") ?: return
    val (partyId, lootId, memberId) = ids
    val request = call.receive<PayoutRequest>()

    val outcome =
        transaction {
            ensureUser(userId, email)
            when {
                !ownsParty(partyId, userId) -> null
                findLoot(lootId, partyId) == null -> null
                // No row means this member is not on the drop's pinned roster: they joined after
                // it sold, or they are the seller. Either way there is nothing owed to mark.
                !setPayoutPaid(lootId, memberId, request.paid, Clock.System.now()) -> null
                else -> findLoot(lootId, partyId)!!
            }
        }
    respondToLoot(outcome, HttpStatusCode.OK)
}

private suspend fun RoutingContext.deleteLootRoute() {
    val (userId, email) = call.principalIdAndEmail()
    val partyId = call.parseUuidParam("id") ?: return
    val lootId = call.parseUuidParam("lootId") ?: return

    val deleted =
        transaction {
            ensureUser(userId, email)
            ownsParty(partyId, userId) && deleteLoot(lootId, partyId)
        }
    call.respond(if (deleted) HttpStatusCode.NoContent else HttpStatusCode.NotFound)
}

/** All three path ids at once, so a handler that needs them keeps to one early return. */
private suspend fun ApplicationCall.parseUuidParams(vararg names: String): List<Uuid>? {
    val parsed = names.map { parameters[it]?.let(Uuid::parseOrNull) }
    if (parsed.any { it == null }) {
        val bad = names.filterIndexed { i, _ -> parsed[i] == null }.joinToString(", ")
        respond(HttpStatusCode.BadRequest, "malformed $bad")
        return null
    }
    return parsed.filterNotNull()
}

/** null is a 404, a String is a refusal with its reason, a LootResponse is the answer. */
private suspend fun RoutingContext.respondToLoot(
    outcome: Any?,
    onSuccess: HttpStatusCode,
) {
    when (outcome) {
        null -> call.respond(HttpStatusCode.NotFound)
        is String -> call.respond(HttpStatusCode.BadRequest, outcome)
        is LootResponse -> call.respond(onSuccess, outcome)
        else -> call.respond(HttpStatusCode.InternalServerError)
    }
}
