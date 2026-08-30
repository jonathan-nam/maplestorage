package com.sharpeyes.backend.parties

import com.sharpeyes.backend.db.BossDropAmount
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyLoot
import org.jetbrains.exposed.v1.core.Coalesce
import org.jetbrains.exposed.v1.core.Expression
import org.jetbrains.exposed.v1.core.JoinType
import org.jetbrains.exposed.v1.core.alias
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

/** This join's own character, so it cannot collide with a caller's. See LootQueries.amountWorld. */
private val amountWorld = Characters.alias("amount_world")

/**
 * The mode a pooled drop fell at: its own, or the config's where it has none.
 *
 * The fallback is what every row did before V69__loot_difficulty.sql, so a drop the backfill could
 * not place behaves exactly as it did rather than dropping out of the piece maths. New rows are
 * stamped at insert (see addLoot), so the set that needs the fallback only ever shrinks.
 *
 * Shared by the two joins that read an amount, which must agree: one decides a drop comes in
 * pieces, the other reads how many, and a drop that is pieces to one and not the other is a split
 * against a bundle count nothing else believes.
 */
internal fun fellAt(): Expression<String?> = Coalesce(PartyLoot.difficulty, Party.difficulty)

/**
 * The drops in these parties that come in pieces, at the mode each FELL at and in its world.
 *
 * Per (boss, difficulty, world), so a drop with no mode anywhere matches no amount: nothing is
 * claimed about it and it is counted the ordinary way.
 *
 * The drop's own mode first, the config's only where the drop has none. Reading the config alone
 * meant editing a party's difficulty re-decided what its existing drops WERE: flipping a Kalos pool
 * from Extreme to Chaos took 540 logged coupons out of the piece maths, because the coupon has no
 * Chaos amount, and nothing on screen said so. See V69__loot_difficulty.sql.
 */
internal fun pieceLootIds(partyIds: List<Uuid>): Set<Uuid> {
    if (partyIds.isEmpty()) return emptySet()
    return PartyLoot
        .join(Party, JoinType.INNER, PartyLoot.partyId, Party.id)
        // Through the character for the world, which the amount is also keyed on, and aliased for the
        // same reason as in lootWithCatalog: a caller may already have Characters in its own FROM.
        .join(amountWorld, JoinType.INNER, Party.characterId, amountWorld[Characters.id])
        .join(BossDropAmount, JoinType.INNER) {
            (BossDropAmount.bossCatalogId eq PartyLoot.bossCatalogId) and
                (BossDropAmount.dropCatalogId eq PartyLoot.dropCatalogId) and
                (BossDropAmount.difficulty eq fellAt()) and
                (BossDropAmount.world eq amountWorld[Characters.worldType])
        }.selectAll()
        .where { PartyLoot.partyId inList partyIds }
        .map { it[PartyLoot.id] }
        .toSet()
}
