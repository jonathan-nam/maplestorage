package com.maplestorage.backend.parties

import com.maplestorage.backend.db.BossCatalog
import com.maplestorage.backend.db.DropCatalog
import com.maplestorage.backend.db.Party
import com.maplestorage.backend.db.PartyLoot
import com.maplestorage.backend.db.PartyLootPayout
import org.jetbrains.exposed.v1.core.JoinType
import org.jetbrains.exposed.v1.core.ResultRow
import org.jetbrains.exposed.v1.core.SortOrder
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.jdbc.selectAll
import kotlin.uuid.Uuid

// The loot pool's reads, and the status every row's shape is derived from. Writes are in
// LootWrites.kt. Inside a transaction, like the rest. Nothing here computes money: see LootDtos.kt.

/** Not sold yet. */
internal const val STATUS_PENDING = "PENDING"

/** Sold, and somebody in the pinned roster is still unpaid. */
internal const val STATUS_SOLD = "SOLD"

/** Sold and everyone has been paid. */
internal const val STATUS_PAID_OUT = "PAID_OUT"

internal val AMOUNT_BASES = setOf("LISTED", "RECEIVED")
internal val SPLIT_METHODS = setOf("LAZY", "FAIR")

/** A drop with its catalog name, icon and boss attached, which is every read of the pool. */
private fun lootWithCatalog() =
    PartyLoot
        .join(DropCatalog, JoinType.LEFT, PartyLoot.dropCatalogId, DropCatalog.id)
        .join(BossCatalog, JoinType.LEFT, PartyLoot.bossCatalogId, BossCatalog.id)

/** Who is owed on these drops, in one query rather than one per drop. */
private fun payoutsFor(lootIds: List<Uuid>): Map<Uuid, List<LootPayoutResponse>> =
    PartyLootPayout
        .selectAll()
        .where { PartyLootPayout.lootId inList lootIds }
        .groupBy({ it[PartyLootPayout.lootId] }) {
            LootPayoutResponse(
                memberId = it[PartyLootPayout.memberId].toString(),
                paid = it[PartyLootPayout.paid],
                paidAt = it[PartyLootPayout.paidAt]?.toString(),
            )
        }

internal fun lootFor(partyId: Uuid): List<LootResponse> {
    val rows =
        lootWithCatalog()
            .selectAll()
            .where { PartyLoot.partyId eq partyId }
            // Newest first: the pool is a worklist, and the drop you just logged is the one you
            // are about to sell.
            .orderBy(PartyLoot.droppedOn to SortOrder.DESC, PartyLoot.createdAt to SortOrder.DESC)
            .toList()
    if (rows.isEmpty()) return emptyList()

    val payoutsByLoot = payoutsFor(rows.map { it[PartyLoot.id] })
    return rows.map { it.toLootResponse(payoutsByLoot[it[PartyLoot.id]].orEmpty()) }
}

/**
 * Every pool this account has, in three queries rather than three per party.
 *
 * For the wallet, which nets what you owe against what you are owed and so has to see all of them
 * at once. The rows are the same ones lootFor() returns, ungrouped and re-grouped here: a second
 * shape for the same drop is a second thing to keep in step.
 */
internal fun allLootFor(userId: String): List<PartyLootPoolResponse> {
    val rows =
        lootWithCatalog()
            .join(Party, JoinType.INNER, PartyLoot.partyId, Party.id)
            .selectAll()
            .where { Party.userId eq userId }
            .orderBy(PartyLoot.droppedOn to SortOrder.DESC, PartyLoot.createdAt to SortOrder.DESC)
            .toList()
    if (rows.isEmpty()) return emptyList()

    val payoutsByLoot = payoutsFor(rows.map { it[PartyLoot.id] })
    // groupBy keeps the order rows arrived in, so each pool stays newest-first.
    return rows
        .groupBy { it[PartyLoot.partyId] }
        .map { (partyId, pool) ->
            PartyLootPoolResponse(
                partyId = partyId.toString(),
                loot = pool.map { it.toLootResponse(payoutsByLoot[it[PartyLoot.id]].orEmpty()) },
            )
        }
}

internal fun findLoot(
    lootId: Uuid,
    partyId: Uuid,
): LootResponse? = lootFor(partyId).firstOrNull { it.id == lootId.toString() }

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
