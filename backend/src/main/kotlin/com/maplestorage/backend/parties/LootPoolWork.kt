package com.maplestorage.backend.parties

import com.maplestorage.backend.db.BossDropAmount
import com.maplestorage.backend.db.Party
import com.maplestorage.backend.db.PartyLoot
import org.jetbrains.exposed.v1.core.JoinType
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.jdbc.selectAll
import kotlin.uuid.Uuid

// Which drops in a pool are still WORK, as against a record of something that already went right.
//
// Split from LootQueries.kt only for size, and because the answer needs tables nothing else in
// there touches.
//
// A drop that comes in pieces is settled through the tranche ledger and NEVER through a sale on its
// own row. Its sold_at stays null for ever, so "not sold" says nothing about it: counting it put
// every coupon drop the account had ever had into the pool, permanently. What is left to do about
// one is said in COUPONS, on the party row and on the Drop Log, so counting the row as well would
// be the same fact twice. Mirrors isOutstanding in frontend/lib/drop-log.ts.

/**
 * The drops in these parties that come in pieces, at the mode each party runs.
 *
 * Per (boss, difficulty), so a party with no mode recorded matches no amount: nothing is claimed
 * about its drops and they are counted the ordinary way.
 */
internal fun pieceLootIds(partyIds: List<Uuid>): Set<Uuid> {
    if (partyIds.isEmpty()) return emptySet()
    return PartyLoot
        .join(Party, JoinType.INNER, PartyLoot.partyId, Party.id)
        .join(BossDropAmount, JoinType.INNER) {
            (BossDropAmount.bossCatalogId eq PartyLoot.bossCatalogId) and
                (BossDropAmount.dropCatalogId eq PartyLoot.dropCatalogId) and
                (BossDropAmount.difficulty eq Party.difficulty)
        }.selectAll()
        .where { PartyLoot.partyId inList partyIds }
        .map { it[PartyLoot.id] }
        .toSet()
}
