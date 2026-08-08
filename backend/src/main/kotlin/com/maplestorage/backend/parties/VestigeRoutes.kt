package com.maplestorage.backend.parties

import com.maplestorage.backend.db.VestigeTranche
import com.maplestorage.backend.plugins.parseUuidParam
import com.maplestorage.backend.plugins.principalIdAndEmail
import com.maplestorage.backend.users.ensureUser
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.call
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.RoutingContext
import io.ktor.server.routing.delete
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import kotlinx.serialization.Serializable
import org.jetbrains.exposed.v1.core.SortOrder
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import kotlin.time.Clock
import kotlin.uuid.Uuid

// The one input the piece ledger runs on: /api/vestige-tranches.
//
// A tranche is "sold 50 pieces for 1.2b", and it names no boss. Which boss each piece paid for is
// worked out by frontend/lib/piece-ledger.ts, oldest cleared first, and nothing here repeats that:
// this end stores what a human entered and hands it back oldest first, which is the order the queue
// is spent in.
//
// Whose sales they are is a LOOTER NAME, not a party and not a seat id. Pieces sit in one character's
// inventory and a coupon trades once, so they cannot be moved between characters: one character's
// pile is one tally. The looter is not always yours, which is what a duo running a character off your
// account settles into, and then the figures are what they reported rather than what you listed.

/** The most pieces one tranche can hold, and the most a stack is worth. Typo guards, matching V38. */
private const val MAX_PIECES = 1_000_000

@Serializable
data class VestigeTrancheResponse(
    val id: String,
    /** Lowercased, as stored: it is an identity, and seats are matched by name everywhere else. */
    val looterName: String,
    val pieces: Int,
    /** Mesos for the whole tranche. The per-piece figure is derived by the client, never stored. */
    val amount: Long,
    val soldAt: String,
)

@Serializable
data class AddVestigeTrancheRequest(
    val looterName: String,
    val pieces: Int,
    val amount: Long,
)

fun Route.vestigeRoutes() {
    get { listTranches() }
    post { addTrancheRoute() }
    delete("/{trancheId}") { deleteTrancheRoute() }
}

private suspend fun RoutingContext.listTranches() {
    val (userId, email) = call.principalIdAndEmail()
    val rows =
        transaction {
            ensureUser(userId, email)
            tranchesFor(userId)
        }
    call.respond(rows)
}

private suspend fun RoutingContext.addTrancheRoute() {
    val (userId, email) = call.principalIdAndEmail()
    val request = call.receive<AddVestigeTrancheRequest>()
    val looter = request.looterName.trim().lowercase()

    val refusal = trancheRefusal(looter, request.pieces, request.amount)
    if (refusal != null) return call.respond(HttpStatusCode.BadRequest, refusal)

    val rows =
        transaction {
            ensureUser(userId, email)
            val now = Clock.System.now()
            VestigeTranche.insert {
                it[id] = Uuid.random()
                it[VestigeTranche.userId] = userId
                it[looterName] = looter
                it[pieces] = request.pieces
                it[amount] = request.amount
                it[soldAt] = now
                it[createdAt] = now
            }
            tranchesFor(userId)
        }
    // The whole tally, not the one row: the queue is re-spent from all of it, so a client redrawing
    // from one added row would be guessing at where the pieces landed.
    call.respond(HttpStatusCode.Created, rows)
}

private suspend fun RoutingContext.deleteTrancheRoute() {
    val (userId, email) = call.principalIdAndEmail()
    val trancheId = call.parseUuidParam("trancheId") ?: return
    val rows =
        transaction {
            ensureUser(userId, email)
            val gone =
                VestigeTranche.deleteWhere {
                    (VestigeTranche.id eq trancheId) and (VestigeTranche.userId eq userId)
                } > 0
            if (gone) tranchesFor(userId) else null
        }
    if (rows == null) call.respond(HttpStatusCode.NotFound) else call.respond(rows)
}

/** Why this tranche cannot be recorded, or null. */
internal fun trancheRefusal(
    looterName: String,
    pieces: Int,
    amount: Long,
): String? =
    when {
        looterName.isEmpty() -> "looterName is whose pieces these were, and cannot be blank"
        pieces < 1 || pieces > MAX_PIECES -> "pieces must be between 1 and $MAX_PIECES"
        // Zero is allowed: a stack handed over rather than sold is a real thing to record, and it
        // prices that boss at nothing rather than refusing to price it at all.
        amount < 0 -> "amount cannot be negative"
        else -> null
    }

/**
 * Every tranche this account has entered, oldest first.
 *
 * Oldest first because that is the order the queue spends them in: the first pieces sold pay for the
 * boss cleared first. Reversing this would re-price every boss.
 *
 * Must run inside a transaction.
 */
internal fun tranchesFor(userId: String): List<VestigeTrancheResponse> =
    VestigeTranche
        .selectAll()
        .where { VestigeTranche.userId eq userId }
        .orderBy(VestigeTranche.soldAt to SortOrder.ASC, VestigeTranche.createdAt to SortOrder.ASC)
        .map {
            VestigeTrancheResponse(
                id = it[VestigeTranche.id].toString(),
                looterName = it[VestigeTranche.looterName],
                pieces = it[VestigeTranche.pieces],
                amount = it[VestigeTranche.amount],
                soldAt = it[VestigeTranche.soldAt].toString(),
            )
        }
