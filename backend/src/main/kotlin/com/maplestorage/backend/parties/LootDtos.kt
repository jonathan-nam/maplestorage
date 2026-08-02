package com.maplestorage.backend.parties

import kotlinx.serialization.Serializable

// Mirrored by the frontend's types/loot.ts field-for-field.
//
// No share, payout or fee is computed here or stored. The split arithmetic has one implementation
// (frontend/lib/drop-split.ts) and these carry only what a human entered, plus who has been paid.

@Serializable
data class LootPayoutResponse(
    val memberId: String,
    val paid: Boolean,
    val paidAt: String?,
)

@Serializable
data class LootResponse(
    val id: String,
    // The catalog drop this is, when it came from a boss table. Null for free text.
    val dropKey: String?,
    val customName: String?,
    // What to show: the catalog name or the typed one. Sent resolved so the client does not join
    // the drop catalog to draw a row.
    val name: String,
    val iconUrl: String?,
    // ALWAYS / HEROIC when each member gets their own copy of this drop. Carried onto the row so
    // the pool can say a split is not what this drop needs.
    val perMember: String?,
    val bossKey: String?,
    val droppedOn: String,
    // PENDING (not sold), SOLD (sold, someone still unpaid), PAID_OUT (everyone paid). Derived
    // from the sale and the payout rows rather than stored, so it cannot drift from them.
    val status: String,
    val saleAmount: Long?,
    val amountBasis: String?,
    val splitMethod: String?,
    val sellerMemberId: String?,
    val soldAt: String?,
    // Who is owed, as pinned when the drop sold. Empty until then.
    val payouts: List<LootPayoutResponse>,
    // Seat ids of who ran the week this drop FELL in. Who a sale may name as its seller and who it
    // will owe, which is neither the party as it stands now nor every seat it has ever had. The
    // seller select reads this, so it offers exactly what the sell route accepts.
    val ranThatWeek: List<String> = emptyList(),
)

/**
 * One party's whole pool, for the account-wide read behind the wallet.
 *
 * Grouped by party because the split needs the party's seats to be read at all: a share is owed by
 * one seat to another, and which seats those are is the party's, not the drop's.
 */
@Serializable
data class PartyLootPoolResponse(
    val partyId: String,
    val loot: List<LootResponse>,
)

@Serializable
data class AddLootRequest(
    // Exactly one of these. A drop key names a catalog item (and brings its icon and per-member
    // warning); custom text covers anything the tables do not list.
    val dropKey: String? = null,
    val customName: String? = null,
    val bossKey: String? = null,
    // ISO date. Defaults to today on the server, which is the day you are almost always logging.
    val droppedOn: String? = null,
)

/**
 * Marking a drop sold: the facts of the sale, none of its arithmetic.
 *
 * Sending this again updates the figures (a corrected price, the other split method) and leaves
 * the payout roster alone, so who has already been paid survives a typo fix.
 */
@Serializable
data class SellLootRequest(
    val amount: Long,
    // LISTED (what it was listed at) or RECEIVED (what landed in the seller's inventory).
    val amountBasis: String,
    // LAZY or FAIR. See lib/drop-split.ts for what the difference costs.
    val splitMethod: String,
    val sellerMemberId: String,
)

@Serializable
data class PayoutRequest(
    val paid: Boolean,
)

/** One payout row, named the only way it is unique: which drop, and who is owed on it. */
@Serializable
data class PayoutRef(
    val lootId: String,
    val memberId: String,
)

/**
 * Settling a whole relationship in one go: every payout row that one net transfer covers.
 *
 * The client names the rows rather than naming a person, because who owes whom is worked out by
 * frontend/lib/wallet.ts and a second implementation here would be a second answer to it. This
 * end of it only marks rows paid.
 *
 * All of them or none. A settle that half-lands leaves some shares paid and some not, with the
 * wallet showing a smaller debt and nothing on screen saying which part of the transfer happened.
 */
@Serializable
data class SettleRequest(
    val payouts: List<PayoutRef>,
)
