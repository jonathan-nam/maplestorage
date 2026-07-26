package com.maplestorage.backend.parties

import com.maplestorage.backend.db.BossCatalog
import com.maplestorage.backend.db.DropCatalog
import com.maplestorage.backend.db.PartyLoot
import com.maplestorage.backend.db.PartyLootPayout
import com.maplestorage.backend.db.PartyMember
import kotlinx.datetime.LocalDate
import org.jetbrains.exposed.v1.core.JoinType
import org.jetbrains.exposed.v1.core.ResultRow
import org.jetbrains.exposed.v1.core.SortOrder
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.core.neq
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.update
import kotlin.time.Instant
import kotlin.uuid.Uuid

// The loot pool's reads and writes. Inside a transaction, like the rest. Nothing here computes
// money: see LootDtos.kt.

/** Not sold yet. */
internal const val STATUS_PENDING = "PENDING"

/** Sold, and somebody in the pinned roster is still unpaid. */
internal const val STATUS_SOLD = "SOLD"

/** Sold and everyone has been paid. */
internal const val STATUS_PAID_OUT = "PAID_OUT"

internal val AMOUNT_BASES = setOf("LISTED", "RECEIVED")
internal val SPLIT_METHODS = setOf("LAZY", "FAIR")

internal fun lootFor(partyId: Uuid): List<LootResponse> {
    val rows =
        PartyLoot
            .join(DropCatalog, JoinType.LEFT, PartyLoot.dropCatalogId, DropCatalog.id)
            .join(BossCatalog, JoinType.LEFT, PartyLoot.bossCatalogId, BossCatalog.id)
            .selectAll()
            .where { PartyLoot.partyId eq partyId }
            // Newest first: the pool is a worklist, and the drop you just logged is the one you
            // are about to sell.
            .orderBy(PartyLoot.droppedOn to SortOrder.DESC, PartyLoot.createdAt to SortOrder.DESC)
            .toList()
    if (rows.isEmpty()) return emptyList()

    val payoutsByLoot =
        PartyLootPayout
            .selectAll()
            .where { PartyLootPayout.lootId inList rows.map { it[PartyLoot.id] } }
            .groupBy({ it[PartyLootPayout.lootId] }) {
                LootPayoutResponse(
                    memberId = it[PartyLootPayout.memberId].toString(),
                    paid = it[PartyLootPayout.paid],
                    paidAt = it[PartyLootPayout.paidAt]?.toString(),
                )
            }

    return rows.map { it.toLootResponse(payoutsByLoot[it[PartyLoot.id]].orEmpty()) }
}

internal fun findLoot(
    lootId: Uuid,
    partyId: Uuid,
): LootResponse? = lootFor(partyId).firstOrNull { it.id == lootId.toString() }

internal fun addLoot(
    partyId: Uuid,
    dropCatalogId: Uuid?,
    customName: String?,
    bossCatalogId: Uuid?,
    droppedOn: LocalDate,
    now: Instant,
): Uuid {
    val lootId = Uuid.random()
    PartyLoot.insert {
        it[id] = lootId
        it[PartyLoot.partyId] = partyId
        it[PartyLoot.dropCatalogId] = dropCatalogId
        it[PartyLoot.customName] = customName
        it[PartyLoot.bossCatalogId] = bossCatalogId
        it[PartyLoot.droppedOn] = droppedOn
        it[createdAt] = now
        it[updatedAt] = now
    }
    return lootId
}

/**
 * Records the sale, and pins who is owed for it.
 *
 * The payout roster is written once, on the first sale, and never re-derived: adding a member next
 * week must not create a debt on a drop they were not there for, and correcting a price must not
 * wipe out who has already been paid.
 */
internal fun sellLoot(
    lootId: Uuid,
    request: SellLootRequest,
    sellerMemberId: Uuid,
    partyId: Uuid,
    now: Instant,
) {
    PartyLoot.update({ PartyLoot.id eq lootId }) {
        it[soldAt] = now
        it[saleAmount] = request.amount
        it[amountBasis] = request.amountBasis
        it[splitMethod] = request.splitMethod
        it[PartyLoot.sellerMemberId] = sellerMemberId
        it[updatedAt] = now
    }

    if (!PartyLootPayout.selectAll().where { PartyLootPayout.lootId eq lootId }.empty()) return
    PartyMember
        .selectAll()
        .where { (PartyMember.partyId eq partyId) and (PartyMember.id neq sellerMemberId) }
        .forEach { member ->
            PartyLootPayout.insert {
                it[PartyLootPayout.lootId] = lootId
                it[memberId] = member[PartyMember.id]
                it[paid] = false
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

internal fun deleteLoot(
    lootId: Uuid,
    partyId: Uuid,
): Boolean = PartyLoot.deleteWhere { (PartyLoot.id eq lootId) and (PartyLoot.partyId eq partyId) } > 0

/**
 * Seats that cannot be removed from a party because loot history points at them.
 *
 * Refusing beats cascading: a payout row is the record that somebody was paid, and deleting the
 * seat would delete the record while leaving the money real.
 */
internal fun seatsWithLootHistory(partyId: Uuid): Set<Uuid> {
    val sellers =
        PartyLoot
            .selectAll()
            .where { PartyLoot.partyId eq partyId }
            .mapNotNull { it[PartyLoot.sellerMemberId] }
    val owed =
        PartyLootPayout
            .innerJoin(PartyLoot)
            .selectAll()
            .where { PartyLoot.partyId eq partyId }
            .map { it[PartyLootPayout.memberId] }
    return (sellers + owed).toSet()
}

/** Derived, never stored, so it cannot drift from the sale and the payout rows it reads. */
private fun statusOf(
    sold: Boolean,
    payouts: List<LootPayoutResponse>,
): String =
    when {
        !sold -> STATUS_PENDING
        payouts.all { it.paid } -> STATUS_PAID_OUT
        else -> STATUS_SOLD
    }

private fun ResultRow.toLootResponse(payouts: List<LootPayoutResponse>): LootResponse {
    val sold = this[PartyLoot.soldAt] != null
    return LootResponse(
        id = this[PartyLoot.id].toString(),
        dropKey = this.getOrNull(DropCatalog.dropKey),
        customName = this[PartyLoot.customName],
        // One of the two is always set (party_loot_named_once), so this cannot fall through to a
        // blank row.
        name = this.getOrNull(DropCatalog.name) ?: this[PartyLoot.customName].orEmpty(),
        iconUrl = this.getOrNull(DropCatalog.iconRefKey)?.let { "/drop-icons/$it" },
        perMember = this.getOrNull(DropCatalog.perMember),
        bossKey = this.getOrNull(BossCatalog.bossKey),
        droppedOn = this[PartyLoot.droppedOn].toString(),
        status = statusOf(sold, payouts),
        saleAmount = this[PartyLoot.saleAmount],
        amountBasis = this[PartyLoot.amountBasis],
        splitMethod = this[PartyLoot.splitMethod],
        sellerMemberId = this[PartyLoot.sellerMemberId]?.toString(),
        soldAt = this[PartyLoot.soldAt]?.toString(),
        payouts = payouts,
    )
}
