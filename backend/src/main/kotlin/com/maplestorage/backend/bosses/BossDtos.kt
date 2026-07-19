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
