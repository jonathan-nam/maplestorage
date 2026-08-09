package com.maplestorage.backend.parties

// What a drop and a sale have to be true of before they are written. Beside the config rules in
// PartyValidation.kt rather than in them: these read a loot row, not a party.

// The bound V34__loot_quantity_and_shares.sql checks. Refused here so the answer is a reason rather
// than a constraint violation, and pinned by a test so the two cannot drift.
private const val MAX_QUANTITY = 1_000_000

/** Why this many of a drop cannot be logged, or null. */
internal fun quantityRefusal(quantity: Int): String? =
    if (quantity < 1 || quantity > MAX_QUANTITY) "quantity must be between 1 and $MAX_QUANTITY" else null

/**
 * Why these share counts cannot be pinned to a sale, or null.
 *
 * A seat the sale cannot owe is refused rather than ignored: accepting a share for somebody who did
 * not run that week would leave the party expecting a payout that no row exists for.
 */
internal fun sharesRefusal(
    shares: Map<String, Int>,
    ranThatWeek: List<String>,
): String? =
    when {
        shares.keys.any { it !in ranThatWeek } -> "shares may only name somebody who ran this boss that week"
        shares.values.any { it < 1 || it > MAX_SHARES } -> "a share count must be between 1 and $MAX_SHARES"
        else -> null
    }

/**
 * Why this arrangement of stacks cannot be recorded against a drop, or null.
 *
 * The sum has to be the whole drop. A partial arrangement is the dangerous shape: it looks answered
 * and produces a debt measured against stacks nobody accounted for, which is a confident wrong
 * number rather than a missing one. Empty is how "nobody has said" is expressed, and it is written
 * by deleting the rows rather than by storing a partial one.
 *
 * `bundles` null is a drop whose stacks nobody has counted, so there is nothing to check an
 * arrangement against and it is refused rather than stored unvalidated.
 */
internal fun bundlesRefusal(
    assignment: Map<String, Int>,
    ranThatWeek: List<String>,
    bundles: Int?,
): String? =
    when {
        assignment.isEmpty() -> null
        bundles == null -> "this drop has no stack count, so who picked up which cannot be recorded"
        assignment.keys.any { it !in ranThatWeek } ->
            "stacks may only be given to somebody who ran this boss that week"
        assignment.values.any { it < 1 } -> "a seat that picked up no stacks is left out, not given zero"
        assignment.values.sum() != bundles ->
            "the stacks have to add up to the $bundles this drop fell in, got ${assignment.values.sum()}"
        else -> null
    }
