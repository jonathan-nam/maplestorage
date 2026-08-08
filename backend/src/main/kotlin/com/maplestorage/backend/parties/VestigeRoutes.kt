package com.maplestorage.backend.parties

import com.maplestorage.backend.db.Person
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
// Whose sales they are is a PERSON, not a character and not a party. One human runs several
// characters, and what the ledger settles is what that human owes; which of their inventories a
// coupon sat in is not the unit. See V39 for the three kinds of holder and why SELF is one of them.

/** The most pieces one tranche can hold, and the most a stack is worth. Typo guards, matching V38. */
private const val MAX_PIECES = 1_000_000

private const val PERSON = "PERSON"
private const val SELF = "SELF"
private const val CHARACTER = "CHARACTER"

/**
 * Whose pile a tranche is, as the three kinds V39 stores.
 *
 * Carried on the way out as well as in, so a client never has to infer the kind from which field is
 * null. A pile with no kind is a pile belonging to nobody, and it would price every boss it covers
 * at nothing.
 */
@Serializable
data class VestigeHolder(
    val kind: String,
    val personId: String? = null,
    /** Lowercased, as stored: it is an identity, and seats are matched by name everywhere else. */
    val characterName: String? = null,
)

@Serializable
data class VestigeTrancheResponse(
    val id: String,
    val holder: VestigeHolder,
    val pieces: Int,
    /** Mesos for the whole tranche. The per-piece figure is derived by the client, never stored. */
    val amount: Long,
    val soldAt: String,
)

@Serializable
data class AddVestigeTrancheRequest(
    val holder: VestigeHolder,
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
    val holder = request.holder.normalised()

    val refusal = trancheRefusal(holder, request.pieces, request.amount)
    if (refusal != null) return call.respond(HttpStatusCode.BadRequest, refusal)

    val result =
        transaction {
            ensureUser(userId, email)
            val person = holder.personId?.let { runCatching { Uuid.parse(it) }.getOrNull() }
            if (holder.kind == PERSON) {
                // Scoped to the account, which the foreign key does not do: without this a tranche
                // could be filed against somebody else's person and read back as one of theirs.
                val theirs =
                    person != null &&
                        Person
                            .selectAll()
                            .where { (Person.id eq person) and (Person.userId eq userId) }
                            .empty()
                            .not()
                if (!theirs) return@transaction null
            }

            val now = Clock.System.now()
            VestigeTranche.insert {
                it[id] = Uuid.random()
                it[VestigeTranche.userId] = userId
                it[holderKind] = holder.kind
                it[personId] = person
                it[characterName] = holder.characterName
                it[pieces] = request.pieces
                it[amount] = request.amount
                it[soldAt] = now
                it[createdAt] = now
            }
            tranchesFor(userId)
        }
    // The whole tally, not the one row: the queue is re-spent from all of it, so a client redrawing
    // from one added row would be guessing at where the pieces landed.
    if (result == null) {
        call.respond(HttpStatusCode.BadRequest, "personId is not somebody on your people list")
    } else {
        call.respond(HttpStatusCode.Created, result)
    }
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

/** Trimmed, and the name folded, so one pile cannot arrive under two spellings. */
internal fun VestigeHolder.normalised(): VestigeHolder =
    VestigeHolder(
        kind = kind.trim().uppercase(),
        personId = personId?.trim()?.takeIf { it.isNotEmpty() },
        characterName = characterName?.trim()?.lowercase()?.takeIf { it.isNotEmpty() },
    )

/** Why this tranche cannot be recorded, or null. */
internal fun trancheRefusal(
    holder: VestigeHolder,
    pieces: Int,
    amount: Long,
): String? =
    when {
        holder.kind !in setOf(PERSON, SELF, CHARACTER) ->
            "holder.kind must be one of $PERSON, $SELF, $CHARACTER"
        // The kind and the reference cannot disagree, matching the constraints in V39: a PERSON pile
        // with no person is a pile belonging to nobody.
        (holder.kind == PERSON) != (holder.personId != null) ->
            "a $PERSON holder needs a personId, and nothing else does"
        (holder.kind == CHARACTER) != (holder.characterName != null) ->
            "a $CHARACTER holder needs a characterName, and nothing else does"
        holder.personId != null && runCatching { Uuid.parse(holder.personId) }.isFailure ->
            "personId is not an id"
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
            val holder =
                VestigeHolder(
                    kind = it[VestigeTranche.holderKind],
                    personId = it[VestigeTranche.personId]?.toString(),
                    characterName = it[VestigeTranche.characterName],
                )
            VestigeTrancheResponse(
                id = it[VestigeTranche.id].toString(),
                holder = holder,
                pieces = it[VestigeTranche.pieces],
                amount = it[VestigeTranche.amount],
                soldAt = it[VestigeTranche.soldAt].toString(),
            )
        }
