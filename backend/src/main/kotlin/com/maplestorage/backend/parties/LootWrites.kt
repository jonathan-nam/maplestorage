package com.maplestorage.backend.parties

import com.maplestorage.backend.db.Party
import com.maplestorage.backend.db.PartyLoot
import com.maplestorage.backend.db.PartyLootPayout
import com.maplestorage.backend.db.PartyMember
import kotlinx.datetime.LocalDate
import org.jetbrains.exposed.v1.core.JoinType
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

// The loot pool's writes, split from its reads the way PartyWrites.kt is split from PartyQueries.kt.
// Inside a transaction, like the rest. Nothing here computes money: see LootDtos.kt.

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
