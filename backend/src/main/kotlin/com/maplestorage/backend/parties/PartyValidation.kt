package com.maplestorage.backend.parties

import com.maplestorage.backend.db.Characters
import com.maplestorage.backend.db.Party
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.jdbc.selectAll
import kotlin.uuid.Uuid

// What a config has to be true of before it is written. Split from the routes only for size; the
// rules themselves are the interesting part, and they refuse rather than repair.

/**
 * Why this config cannot be created, or null.
 *
 * Refuses rather than repairs: a second config for the same character and boss, a boss the catalog
 * does not have, or somebody else's character would each save something the user did not ask for.
 * Must run inside a transaction.
 */
internal fun validateNewParty(
    request: SavePartyRequest,
    userId: String,
    characterId: Uuid?,
    bossCatalogId: Uuid?,
): String? {
    val owned =
        characterId != null &&
            Characters
                .selectAll()
                .where { (Characters.id eq characterId) and (Characters.userId eq userId) }
                .empty()
                .not()
    val taken =
        characterId != null &&
            bossCatalogId != null &&
            Party
                .selectAll()
                .where { (Party.characterId eq characterId) and (Party.bossCatalogId eq bossCatalogId) }
                .empty()
                .not()

    return when {
        !owned -> "characterId must be one of your characters"
        bossCatalogId == null -> "unknown bossKey"
        taken -> "that character already has a party for this boss"
        else -> validateMembers(request.members)
    }
}

/**
 * The rules a config's roster has to keep, wherever it is being written.
 *
 * An EMPTY roster is allowed, and is a solo run. It used to be refused, on the reasoning that a
 * party of one is not a party. That was right about the word and wrong about the need: a config is
 * what a loot pool hangs off, so refusing solo runs meant a drop off a boss you solo could not be
 * recorded anywhere, and the drop log silently missed everything you killed alone. The split of a
 * solo sale is already well defined (splitDrop keeps the lot; see drop-split.ts).
 */
internal fun validateMembers(members: List<String>): String? {
    val names = members.map { it.trim() }
    return when {
        names.size > MAX_PARTY_SIZE - 1 -> "a party holds at most $MAX_PARTY_SIZE including your character"
        names.any { it.isBlank() } -> "a member needs a character name"
        names.map { it.lowercase() }.distinct().size != names.size -> "the same character twice"
        else -> null
    }
}
