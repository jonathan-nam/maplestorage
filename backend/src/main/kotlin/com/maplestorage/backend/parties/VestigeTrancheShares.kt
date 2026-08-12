package com.maplestorage.backend.parties

import kotlin.uuid.Uuid

// Whose pieces a sale was: the one place a coupon debt gets a price. See V56.
//
// It only ever prices a sale WHOSE PRICE THE ENTERER TYPED. When you loot the lot, the pieces you
// owe are in your own inventory, so the figure being divided is one you know. What somebody else
// sold at is still not asked for, and still could not be answered: that is the pro rata #354 deleted.

/**
 * How one holder is matched, mirroring holderKey() in frontend/lib/vestige-ledger.ts.
 *
 * Only used to spot the same creditor named twice on one sale, which two rows would double.
 */
private fun VestigeHolder.key(): String =
    when (kind) {
        PERSON -> "person:$personId"
        CHARACTER -> "character:$characterName"
        else -> "self"
    }

/**
 * Why this sale's attribution cannot be recorded, or null. See V56.
 *
 * The ceiling is here rather than on the table because a check constraint cannot read the parent
 * row. Attributing more pieces than the sale held would credit somebody money the sale never made.
 */
internal fun shareRefusal(
    holder: VestigeHolder,
    pieces: Int,
    disposition: String,
    shares: List<VestigeTrancheShareRow>,
): String? {
    if (shares.isEmpty()) return null
    val bad = shares.firstOrNull { it.holder.kind !in setOf(PERSON, SELF, CHARACTER) }
    return when {
        // A sale is the only fate with proceeds to divide. A redemption realized nothing, and a
        // purchase is already one creditor's in full at a price somebody agreed. See V50.
        disposition != SOLD -> "only a $SOLD tranche can name whose pieces it was"
        bad != null -> "shares[].holder.kind must be one of $PERSON, $SELF, $CHARACTER"
        shares.any { (it.holder.kind == PERSON) != (it.holder.personId != null) } ->
            "a $PERSON holder needs a personId, and nothing else does"
        shares.any { (it.holder.kind == CHARACTER) != (it.holder.characterName != null) } ->
            "a $CHARACTER holder needs a characterName, and nothing else does"
        shares.any {
            it.holder.personId != null && runCatching { Uuid.parse(it.holder.personId) }.isFailure
        } -> "personId is not an id"
        shares.any { it.pieces < 1 } -> "shares[].pieces must be at least 1"
        // The seller cannot owe themselves any of their own sale, and a creditor named twice would
        // be counted twice rather than added up.
        shares.any { it.holder.key() == holder.key() } ->
            "a sale cannot owe its own pile"
        shares.map { it.holder.key() }.toSet().size != shares.size ->
            "each creditor may be named once on a sale"
        shares.sumOf { it.pieces } > pieces ->
            "shares name more pieces than the sale held"
        else -> null
    }
}
