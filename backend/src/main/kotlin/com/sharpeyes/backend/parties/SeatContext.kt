package com.sharpeyes.backend.parties

import kotlin.time.Instant

/**
 * What writing a roster needs besides the names.
 *
 * Grouped because every seat in a save takes all three unchanged: whose account it is, what the
 * Nexon lookup found for the names that are new, and when the save happened.
 */
internal data class SeatContext(
    val userId: String,
    val sprites: Map<String, String?>,
    val now: Instant,
)
