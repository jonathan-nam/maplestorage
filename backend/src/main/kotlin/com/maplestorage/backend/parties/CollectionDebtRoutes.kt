package com.maplestorage.backend.parties

import com.maplestorage.backend.db.CollectionDebt
import com.maplestorage.backend.db.CollectionDebtPayout
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
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import kotlin.time.Clock
import kotlin.uuid.Uuid

// What somebody owes you that no drop accounts for: /api/collection-debts.
//
// The Collection Ledger could only state debts it derived, a share of a sale or a count of pieces, so
// a debt from anywhere else had nowhere to go. This is the one input on that page, and the only figure
// on it that nothing else can know.
//
// Rows, not a running total, the shape V51 uses: only the sum matters, and a mistyped one has to come
// back off.
//
// SIGNED since V57. Positive is what they owe you. Negative is a debt of YOURS discharged against it,
// which is how a share you owe is settled when the two of you agree it comes off the larger sum
// rather than money crossing. See V57 for why marking the share paid alone could not say that.

/** The most one entry can be. A typo guard, matching MAX_AMOUNT on a payment. */
private const val MAX_AMOUNT = 1_000_000_000_000L

/** As long as a note may be, matching the check in V56. Room for what it was for, not for a story. */
private const val MAX_NOTE = 120

/** One share an offset discharged. The PAYOUT, since one drop owes several people. See V58. */
@Serializable
data class CollectionDebtPayoutRow(
    val lootId: String,
    val memberId: String,
)

@Serializable
data class CollectionDebtResponse(
    val id: String,
    val holder: VestigeHolder,
    val amount: Long,
    val note: String? = null,
    /** The shares this discharged. Empty on a hand-entered debt, which is most of them. See V58. */
    val payouts: List<CollectionDebtPayoutRow> = emptyList(),
    val incurredAt: String,
)

@Serializable
data class AddCollectionDebtRequest(
    val holder: VestigeHolder,
    val amount: Long,
    val note: String? = null,
    /** Only an offset names any. Absent is a debt somebody typed, which discharges no share. */
    val payouts: List<CollectionDebtPayoutRow> = emptyList(),
)

fun Route.collectionDebtRoutes() {
    get { listDebts() }
    post { addDebtRoute() }
    delete("/{debtId}") { deleteDebtRoute() }
}

private suspend fun RoutingContext.listDebts() {
    val (userId, email) = call.principalIdAndEmail()
    val rows =
        transaction {
            ensureUser(userId, email)
            debtsFor(userId)
        }
    call.respond(rows)
}

private suspend fun RoutingContext.addDebtRoute() {
    val (userId, email) = call.principalIdAndEmail()
    val request = call.receive<AddCollectionDebtRequest>()
    val holder = request.holder.normalised()
    val note = request.note?.trim()?.takeIf { it.isNotEmpty() }

    val refusal = debtRefusal(holder, request.amount, note)
    if (refusal != null) return call.respond(HttpStatusCode.BadRequest, refusal)

    val payouts =
        request.payouts.map { Uuid.parseOrNull(it.lootId) to Uuid.parseOrNull(it.memberId) }
    if (payouts.any { (loot, member) -> loot == null || member == null }) {
        return call.respond(HttpStatusCode.BadRequest, "malformed lootId or memberId")
    }

    val result =
        transaction {
            ensureUser(userId, email)
            val person = holder.personId?.let { runCatching { Uuid.parse(it) }.getOrNull() }
            // Scoped to the account, the check the foreign key does not make. See ownsPerson.
            if (holder.kind == "PERSON" && !ownsPerson(userId, person)) return@transaction null

            val now = Clock.System.now()
            val newDebtId = Uuid.random()
            CollectionDebt.insert {
                it[id] = newDebtId
                it[CollectionDebt.userId] = userId
                it[holderKind] = holder.kind
                it[personId] = person
                it[characterName] = holder.characterName
                it[amount] = request.amount
                it[CollectionDebt.note] = note
                it[incurredAt] = now
                it[createdAt] = now
            }
            // Whatever the offset discharged. Not checked against the payout rows themselves: the
            // settle that marked them paid ran first and is the one that had to prove they exist, and
            // a second check here would refuse a row that write had already accepted.
            for (share in payouts.map { it.first!! to it.second!! }) {
                CollectionDebtPayout.insert {
                    it[debtId] = newDebtId
                    it[lootId] = share.first
                    it[memberId] = share.second
                }
            }
            debtsFor(userId)
        }
    // The whole list, like a tranche or a payment: what a person owes you is read off all of it.
    if (result == null) {
        call.respond(HttpStatusCode.BadRequest, "personId is not somebody on your people list")
    } else {
        call.respond(HttpStatusCode.Created, result)
    }
}

private suspend fun RoutingContext.deleteDebtRoute() {
    val (userId, email) = call.principalIdAndEmail()
    val debtId = call.parseUuidParam("debtId") ?: return
    val rows =
        transaction {
            ensureUser(userId, email)
            val gone =
                CollectionDebt.deleteWhere {
                    (CollectionDebt.id eq debtId) and (CollectionDebt.userId eq userId)
                } > 0
            if (gone) debtsFor(userId) else null
        }
    if (rows == null) call.respond(HttpStatusCode.NotFound) else call.respond(rows)
}

/**
 * Why this entry cannot be recorded, or null.
 *
 * SELF is refused, where a tranche and a payment allow it. Those are about a PILE, and one of the
 * piles is yours; this is about a debt between two people, and a debt to yourself is not one.
 */
internal fun debtRefusal(
    holder: VestigeHolder,
    amount: Long,
    note: String?,
): String? =
    when {
        holder.kind !in setOf("PERSON", "CHARACTER") ->
            "holder.kind must be one of PERSON, CHARACTER"
        // The kind and the reference cannot disagree, matching the checks in V56.
        (holder.kind == "PERSON") != (holder.personId != null) ->
            "a PERSON holder needs a personId, and nothing else does"
        (holder.kind == "CHARACTER") != (holder.characterName != null) ->
            "a CHARACTER holder needs a characterName, and nothing else does"
        holder.personId != null && runCatching { Uuid.parse(holder.personId) }.isFailure ->
            "personId is not an id"
        // SIGNED since V57. Positive is theirs to pay, negative is a debt of yours discharged
        // against it. Zero is refused: an adjustment of nothing is the absence of one.
        amount == 0L -> "amount cannot be zero"
        amount < -MAX_AMOUNT || amount > MAX_AMOUNT ->
            "amount must be between -$MAX_AMOUNT and $MAX_AMOUNT"
        note != null && note.length > MAX_NOTE -> "note must be at most $MAX_NOTE characters"
        else -> null
    }

/**
 * Every entry this account has made, oldest first.
 *
 * Only the sum matters, so the order is for reading. Oldest first to match the tranche and payment
 * lists the same card draws.
 *
 * Must run inside a transaction.
 */
internal fun debtsFor(userId: String): List<CollectionDebtResponse> {
    val rows =
        CollectionDebt
            .selectAll()
            .where { CollectionDebt.userId eq userId }
            .orderBy(
                CollectionDebt.incurredAt to SortOrder.ASC,
                CollectionDebt.createdAt to SortOrder.ASC,
            ).toList()
    if (rows.isEmpty()) return emptyList()

    // One query for every debt's shares rather than one per debt. Most carry none, so the join is
    // short and it is the round trips that would add up.
    val shares =
        CollectionDebtPayout
            .selectAll()
            .where { CollectionDebtPayout.debtId inList rows.map { it[CollectionDebt.id] } }
            .groupBy({ it[CollectionDebtPayout.debtId] }) {
                CollectionDebtPayoutRow(
                    lootId = it[CollectionDebtPayout.lootId].toString(),
                    memberId = it[CollectionDebtPayout.memberId].toString(),
                )
            }

    return rows.map {
        val holder =
            VestigeHolder(
                kind = it[CollectionDebt.holderKind],
                personId = it[CollectionDebt.personId]?.toString(),
                characterName = it[CollectionDebt.characterName],
            )
        CollectionDebtResponse(
            id = it[CollectionDebt.id].toString(),
            holder = holder,
            amount = it[CollectionDebt.amount],
            note = it[CollectionDebt.note],
            payouts = shares[it[CollectionDebt.id]] ?: emptyList(),
            incurredAt = it[CollectionDebt.incurredAt].toString(),
        )
    }
}
