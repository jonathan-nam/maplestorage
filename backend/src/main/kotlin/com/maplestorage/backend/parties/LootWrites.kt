package com.maplestorage.backend.parties

import com.maplestorage.backend.bosses.weekOf
import com.maplestorage.backend.db.Party
import com.maplestorage.backend.db.PartyLoot
import com.maplestorage.backend.db.PartyLootPayout
import kotlinx.datetime.LocalDate
import org.jetbrains.exposed.v1.core.JoinType
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.update
import kotlin.time.Instant
import kotlin.uuid.Uuid

// The loot pool's writes, split from its reads the way PartyWrites.kt is split from PartyQueries.kt.
// Inside a transaction, like the rest. Nothing here computes money: see LootDtos.kt.

/**
 * Logs a drop, and marks its boss cleared where nothing has said otherwise.
 *
 * The clear is written here rather than by the route, so a drop cannot be logged without it: the
 * two are one fact, and a second way in that skipped it would leave a pool of drops beside a boss
 * reading "not reported". What it will and will not overwrite is clearFromDrop's.
 */
internal fun addLoot(
    partyId: Uuid,
    item: LootedDrop,
    bossCatalogId: Uuid?,
    droppedOn: LocalDate,
    now: Instant,
): Uuid {
    val lootId = Uuid.random()
    PartyLoot.insert {
        it[id] = lootId
        it[PartyLoot.partyId] = partyId
        it[dropCatalogId] = item.dropCatalogId
        it[customName] = item.customName
        it[PartyLoot.bossCatalogId] = bossCatalogId
        it[quantity] = item.quantity
        it[PartyLoot.droppedOn] = droppedOn
        it[createdAt] = now
        it[updatedAt] = now
    }
    // Something fell here, so this config is one you run after all. Same reading as the clear
    // below: a drop is evidence of a night, and a retired config would hold it off Party View
    // while the wallet asked you to settle it.
    Party.update({ (Party.id eq partyId) and (Party.standing eq false) }) { it[standing] = true }
    // A drop with no boss names nothing to clear. The pickers always send one, so this is the
    // API-only case rather than an ordinary one.
    if (bossCatalogId != null) {
        // Both present by the FKs the insert above just satisfied: the party exists, and the boss
        // id came out of the catalog.
        val reset = bossResetOf(bossCatalogId)!!
        clearFromDrop(characterIdOfParty(partyId)!!, bossCatalogId, reset, droppedOn, now)
    }
    return lootId
}

/**
 * What fell: which drop it is, and how many.
 *
 * Exactly one of the two names it, which party_loot_named_once requires and the routes refuse
 * before it reaches here. The count is one unless the drop stacks.
 */
internal data class LootedDrop(
    val dropCatalogId: Uuid?,
    val customName: String? = null,
    val quantity: Int = 1,
)

/**
 * Records the sale, and pins who is owed for it.
 *
 * The payout roster is written once, on the first sale, and never re-derived: adding a member next
 * week must not create a debt on a drop they were not there for, and correcting a price must not
 * wipe out who has already been paid.
 *
 * Who is owed is the roster of the week the drop FELL in, not of the week it sells in and not of
 * the party today. A guest who ran that night is owed their share, and a usual member who sat that
 * week out is not, which is the whole point of a week having its own roster.
 *
 * Share counts are part of the figures, so a re-sale corrects them on the rows that already exist
 * rather than adding or dropping any. That keeps who has been paid while letting a mistyped double
 * share be fixed, and a seat left out of the request goes back to one rather than keeping the
 * count from the sale being corrected.
 */
internal fun sellLoot(
    lootId: Uuid,
    request: SellLootRequest,
    sellerMemberId: Uuid,
    partyId: Uuid,
    now: Instant,
) {
    val droppedOn =
        PartyLoot
            .selectAll()
            .where { PartyLoot.id eq lootId }
            .first()[PartyLoot.droppedOn]

    // Absent is one share, which is the even split every sale was before this could be said.
    val sharesFor = { seatId: Uuid -> request.shares[seatId.toString()] ?: 1 }

    PartyLoot.update({ PartyLoot.id eq lootId }) {
        it[soldAt] = now
        it[saleAmount] = request.amount
        it[amountBasis] = request.amountBasis
        it[splitMethod] = request.splitMethod
        it[PartyLoot.sellerMemberId] = sellerMemberId
        it[sellerShares] = sharesFor(sellerMemberId)
        it[updatedAt] = now
    }

    val owed =
        PartyLootPayout
            .selectAll()
            .where { PartyLootPayout.lootId eq lootId }
            .map { it[PartyLootPayout.memberId] }
    if (owed.isNotEmpty()) {
        owed.forEach { seatId ->
            PartyLootPayout.update({
                (PartyLootPayout.lootId eq lootId) and (PartyLootPayout.memberId eq seatId)
            }) {
                it[shares] = sharesFor(seatId)
            }
        }
        return
    }

    rosterFor(partyId, weekOf(droppedOn))
        .filterNot { it == sellerMemberId }
        .forEach { seatId ->
            PartyLootPayout.insert {
                it[PartyLootPayout.lootId] = lootId
                it[memberId] = seatId
                it[paid] = false
                it[shares] = sharesFor(seatId)
            }
        }
}

/** Puts a drop back in the pool, dropping the payout record with it. Destructive on purpose. */
internal fun unsellLoot(
    lootId: Uuid,
    now: Instant,
) {
    PartyLootPayout.deleteWhere { PartyLootPayout.lootId eq lootId }
    PartyLoot.update({ PartyLoot.id eq lootId }) {
        it[soldAt] = null
        it[saleAmount] = null
        it[amountBasis] = null
        it[splitMethod] = null
        it[sellerMemberId] = null
        it[sellerShares] = null
        it[updatedAt] = now
    }
}

/** Marks one member paid or unpaid. Returns false when they are not on this drop's roster. */
internal fun setPayoutPaid(
    lootId: Uuid,
    memberId: Uuid,
    paid: Boolean,
    now: Instant,
): Boolean {
    val changed =
        PartyLootPayout.update({
            (PartyLootPayout.lootId eq lootId) and (PartyLootPayout.memberId eq memberId)
        }) {
            it[PartyLootPayout.paid] = paid
            it[paidAt] = if (paid) now else null
        }
    return changed > 0
}

/**
 * Marks every named payout paid, across parties, or writes nothing at all.
 *
 * False without writing when any ref names a row this account cannot reach: a drop in someone
 * else's party, a member who is not on that drop's roster, or a drop deleted since the wallet was
 * drawn. Refusing the lot beats settling the reachable ones, which would leave the wallet showing
 * a smaller debt with nothing saying which part of the transfer it thinks happened.
 *
 * Rows already paid are left as they are rather than refused, so a settle sent twice is a no-op
 * instead of rewriting when the money moved.
 */
internal fun settlePayouts(
    userId: String,
    refs: List<Pair<Uuid, Uuid>>,
    now: Instant,
): Boolean {
    val wanted = refs.toSet()
    val reachable =
        PartyLootPayout
            .join(PartyLoot, JoinType.INNER, PartyLootPayout.lootId, PartyLoot.id)
            .join(Party, JoinType.INNER, PartyLoot.partyId, Party.id)
            .selectAll()
            .where { (PartyLootPayout.lootId inList wanted.map { it.first }) and (Party.userId eq userId) }
            .map { it[PartyLootPayout.lootId] to it[PartyLootPayout.memberId] }
            .toSet()
    if (!reachable.containsAll(wanted)) return false

    wanted.forEach { (lootId, memberId) ->
        PartyLootPayout.update({
            (PartyLootPayout.lootId eq lootId) and
                (PartyLootPayout.memberId eq memberId) and
                (PartyLootPayout.paid eq false)
        }) {
            it[PartyLootPayout.paid] = true
            it[paidAt] = now
        }
    }
    return true
}

internal fun deleteLoot(
    lootId: Uuid,
    partyId: Uuid,
): Boolean = PartyLoot.deleteWhere { (PartyLoot.id eq lootId) and (PartyLoot.partyId eq partyId) } > 0
