package com.maplestorage.backend.parties

import com.maplestorage.backend.bosses.WEEKLY_CADENCE
import com.maplestorage.backend.bosses.periodAfter
import com.maplestorage.backend.bosses.weekOf
import com.maplestorage.backend.db.BossCatalog
import com.maplestorage.backend.db.DropCatalog
import com.maplestorage.backend.db.Party
import com.maplestorage.backend.db.PartyLoot
import com.maplestorage.backend.db.PartyLootPayout
import kotlinx.datetime.LocalDate
import org.jetbrains.exposed.v1.core.JoinType
import org.jetbrains.exposed.v1.core.ResultRow
import org.jetbrains.exposed.v1.core.SortOrder
import org.jetbrains.exposed.v1.core.and
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

/**
 * The seats that ran each drop's own week, keyed by drop.
 *
 * A drop belongs to the week it fell in, so that is the roster it is measured against: who could
 * have sold it, and who a sale owes. Batched a week at a time rather than asked per drop, since a
 * pool is usually a handful of drops spread over very few weeks.
 */
private fun ranThatWeekFor(rows: List<ResultRow>): Map<Uuid, List<String>> {
    val rostersByWeek =
        rows
            .groupBy({ weekOf(it[PartyLoot.droppedOn]) }) { it[PartyLoot.partyId] }
            .mapValues { (week, partyIds) -> rostersFor(partyIds.distinct(), week) }

    return rows.associate { row ->
        val ran = rostersByWeek[weekOf(row[PartyLoot.droppedOn])]?.get(row[PartyLoot.partyId])
        row[PartyLoot.id] to ran.orEmpty().map { it.toString() }
    }
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
    val ranByLoot = ranThatWeekFor(rows)
    return rows.map {
        it.toLootResponse(payoutsByLoot[it[PartyLoot.id]].orEmpty(), ranByLoot[it[PartyLoot.id]].orEmpty())
    }
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
    val ranByLoot = ranThatWeekFor(rows)
    val response = { row: ResultRow ->
        row.toLootResponse(payoutsByLoot[row[PartyLoot.id]].orEmpty(), ranByLoot[row[PartyLoot.id]].orEmpty())
    }
    // groupBy keeps the order rows arrived in, so each pool stays newest-first.
    return rows
        .groupBy { it[PartyLoot.partyId] }
        .map { (partyId, pool) ->
            PartyLootPoolResponse(partyId = partyId.toString(), loot = pool.map(response))
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

private fun ResultRow.toLootResponse(
    payouts: List<LootPayoutResponse>,
    ranThatWeek: List<String>,
): LootResponse {
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
        ranThatWeek = ranThatWeek,
    )
}

/** Unsold drops, sold ones with somebody still unpaid, and ones with nothing left to do. */
internal data class LootCounts(
    val pending: Int,
    val awaitingPayout: Int,
    // Sold and everybody paid. Carried so a pool that is fully settled is still VISIBLE from the
    // list: with only the two counters above, marking the last share paid made a party's whole
    // drop history vanish from its row, and there was nothing to say the pool was not empty.
    val settled: Int,
)

private data class LootRow(
    val id: Uuid,
    val partyId: Uuid,
    val droppedOn: LocalDate,
    val sold: Boolean,
)

/**
 * The pool counts per config, for one week or for all time.
 *
 * A null [week] counts every drop the pool has ever held, which is what the party's own page and
 * the delete guard want. Otherwise a drop belongs to the week it fell in, so a week that has passed
 * shows the pool it had rather than today's.
 *
 * Outstanding drops are the one exception to that, and they carry FORWARD: something unsold, or
 * sold with somebody still unpaid, is work left to do rather than history, so it keeps counting in
 * every later week until it settles. Otherwise a drop from last week that still owes somebody money
 * would disappear from Party View entirely, which is the silent-omission failure this repo exists
 * to prevent.
 *
 * Nothing carries backwards. A drop that fell after the week being shown is not in that week, so a
 * settled pool stays settled when you step back to it.
 *
 * "Awaiting payout" is derived the same way the loot rows derive their status: sold, and at least
 * one payout row unpaid. Deriving it in one place and storing it in none is what keeps the card's
 * badge and the drop's own status from disagreeing.
 */
internal fun lootCountsFor(
    partyIds: List<Uuid>,
    week: LocalDate?,
): Map<Uuid, LootCounts> {
    val loot =
        if (partyIds.isEmpty()) {
            emptyList()
        } else {
            PartyLoot
                .selectAll()
                .where { PartyLoot.partyId inList partyIds }
                .map {
                    LootRow(
                        it[PartyLoot.id],
                        it[PartyLoot.partyId],
                        it[PartyLoot.droppedOn],
                        it[PartyLoot.soldAt] != null,
                    )
                }
        }
    if (loot.isEmpty()) return emptyMap()

    val unpaidLootIds =
        PartyLootPayout
            .selectAll()
            .where { (PartyLootPayout.lootId inList loot.map { it.id }) and (PartyLootPayout.paid eq false) }
            .map { it[PartyLootPayout.lootId] }
            .toSet()

    // Through periodAfter rather than a +7, so the week a drop is filed under and the week the
    // stepper walks cannot drift apart.
    val weekEnd = week?.let { periodAfter(WEEKLY_CADENCE, it) }

    // Two windows, and the difference between them is the carry-forward. Outstanding drops count
    // from the week they fell in onwards; settled ones count in that week alone.
    val byThen = { row: LootRow -> weekEnd == null || row.droppedOn < weekEnd }
    val inWeek = { row: LootRow -> week == null || (row.droppedOn >= week && byThen(row)) }

    return loot
        .groupBy { it.partyId }
        .mapValues { (_, rows) ->
            LootCounts(
                pending = rows.count { !it.sold && byThen(it) },
                awaitingPayout = rows.count { it.sold && it.id in unpaidLootIds && byThen(it) },
                settled = rows.count { it.sold && it.id !in unpaidLootIds && inWeek(it) },
            )
        }
}
