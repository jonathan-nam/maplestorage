package com.maplestorage.backend.users

// The two kinds of GMS world, as users.world_type, characters.world_type and drop_catalog.worlds
// all spell them. One list, so a third spelling cannot appear.

const val WORLD_INTERACTIVE = "INTERACTIVE"
const val WORLD_HEROIC = "HEROIC"

val WORLD_TYPES = setOf(WORLD_INTERACTIVE, WORLD_HEROIC)

/**
 * The value if it is one of the two, else null.
 *
 * Refusing an unknown world beats storing it: the CHECK constraint would reject it anyway, and a
 * 500 from a violated constraint tells the caller nothing about which field was wrong.
 */
fun worldTypeOrNull(raw: String?): String? = raw?.uppercase()?.takeIf { it in WORLD_TYPES }
