package com.sharpeyes.backend.users

/**
 * A GMS world, and the category that decides whether anything in it can be traded.
 *
 * Nexon's ranking endpoint identifies a world only by a numeric id. It returns no human-readable
 * name, anywhere, and there is no endpoint that lists the worlds. So this mapping cannot be read
 * off the API at runtime, and for a long time the app did not have it: NexonLookupService probed
 * four ids named A, B, C and D, deliberately unnamed, because shipping a guess would have read to a
 * future maintainer as a verified fact.
 *
 * It is verified now. Each row below was pinned on 2026-08-09 by looking up a character whose world
 * its owner named, one per id, and seeing which id returned them. Those four names are in
 * GmsWorldTest as the record of how, so re-deriving this is a morning's work rather than a guess.
 *
 * **A world is the unit of everything, not the category.** Characters in different worlds cannot
 * boss together and cannot trade, and that is true of Scania and Bera as much as of Scania and
 * Kronos. So a list that mixes two worlds permits a party that cannot exist and adds two meso
 * totals that cannot be added. The category is narrower than it looks: it decides tradeability,
 * and nothing else.
 *
 * When GMS merges or adds worlds this goes stale, and it goes stale silently, because a character
 * in an unlisted world simply fails to be found and falls through to manual entry. A dead id
 * answers `totalCount: 0` for every name, which is how to spot one.
 */
enum class GmsWorld(
    val worldId: Int,
    val displayName: String,
    val worldType: String,
) {
    BERA(1, "Bera", WORLD_INTERACTIVE),
    SCANIA(19, "Scania", WORLD_INTERACTIVE),
    KRONOS(45, "Kronos", WORLD_HEROIC),
    HYPERION(70, "Hyperion", WORLD_HEROIC),
    ;

    companion object {
        /** The world with this id, or null for one this build does not know. */
        fun byId(worldId: Int): GmsWorld? = entries.firstOrNull { it.worldId == worldId }

        /**
         * The world by its display name, case-insensitively.
         *
         * For reading `characters.world_name` back, which is stored as the display name so the
         * column stays legible in a psql session rather than being a number to look up.
         */
        fun byName(displayName: String): GmsWorld? =
            entries.firstOrNull { it.displayName.equals(displayName, ignoreCase = true) }
    }
}

/** Every id worth probing. One lookup fans out across all of them: see NexonLookupService. */
val KNOWN_WORLD_IDS: List<Int> = GmsWorld.entries.map { it.worldId }
