package com.sharpeyes.backend.parties

import kotlin.time.Instant
import kotlin.uuid.Uuid

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
) {
    /**
     * The linked accounts' characters, by lowercased name, for binding a seat to one.
     *
     * Read from the userId rather than passed in, so every one of the six places that writes a seat
     * binds one and none of them has to remember to. Lazy because most calls write a seat whose
     * name is nobody's character, and the query is then never made.
     */
    val linkedCharacters: Map<String, Uuid> by lazy { linkedCharactersFor(userId) }
}
