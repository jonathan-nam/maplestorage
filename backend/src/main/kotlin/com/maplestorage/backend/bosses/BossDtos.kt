package com.maplestorage.backend.bosses

import kotlinx.serialization.Serializable

// Mirrored by the frontend's types/boss.ts field-for-field.

@Serializable
data class BossResponse(
    val bossKey: String,
    val name: String,
    // WEEKLY / DAILY / MONTHLY. The client needs it to label a column's cadence, and to know that
    // two bosses in the same matrix are not counting the same span of time.
    val reset: String,
    // The boss's planner portrait, backend-relative and resolved by apiAssetUrl(). Null only if
    // the seed has no art for it, which catalog/build.py refuses to let happen.
    val iconUrl: String? = null,
)

@Serializable
data class BossClearResponse(
    val bossKey: String,
    val cleared: Boolean,
    // The period this row is an answer for, so the client never has to recompute a reset boundary
    // to know what it is looking at. ISO date.
    val periodStart: String,
    val capturedAt: String,
)

/**
 * One view of the matrix: either the current period or one past week.
 *
 * The navigation is served rather than computed client side for the reason the period label already
 * was: the reset boundary has one implementation (BossPeriod.kt), and "the week before this one" is
 * that same boundary asked backwards. A frontend doing its own date arithmetic would be a second
 * copy of the number this feature cannot get wrong.
 */
@Serializable
data class BossClearsViewResponse(
    val clearsByCharacter: Map<String, List<BossClearResponse>>,
    // Null for the current view, which spans three cadences and so has no single period. Set to the
    // week being shown when the user has stepped back.
    val weekStart: String?,
    // Null at either end: no stored history before it, or nowhere newer to go than now.
    val previousWeekStart: String?,
    val nextWeekStart: String?,
    // The week now in progress. The client compares nextWeekStart against it to know that stepping
    // forward once more lands on the live view (all three cadences) rather than on a history slice
    // of the current week, which would quietly drop the daily and monthly rows.
    val currentWeekStart: String,
    // Cadence -> ISO instant of the next rollover, for the countdown. Always about *now*, even when
    // the matrix is showing an old week.
    val nextResets: Map<String, String>,
    // The server's clock at the moment it answered. The countdown ticks against this rather than
    // the browser's own clock, so a skewed machine does not show a confidently wrong time to reset.
    val now: String,
)
