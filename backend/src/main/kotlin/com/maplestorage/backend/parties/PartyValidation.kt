package com.maplestorage.backend.parties

import com.maplestorage.backend.db.BossCatalog
import com.maplestorage.backend.db.Characters
import com.maplestorage.backend.db.Party
import com.maplestorage.backend.db.PartyMember
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
        else -> validateDifficulty(bossCatalogId, request.difficulty) ?: validateMembers(request.members)
    }
}

/**
 * Why this difficulty cannot stand against this boss, or null.
 *
 * Null passes: not saying which mode you run is allowed, and is what every config predating the
 * column says. Saying one the boss does not have is refused rather than dropped, because a config
 * reading "Normal Black Mage" is a fact somebody would believe. The modes come from the catalog
 * row (catalog/bosses.yaml), so a new mode is one edit there and no code change here.
 *
 * Must run inside a transaction.
 */
internal fun validateDifficulty(
    bossCatalogId: Uuid,
    difficulty: String?,
): String? {
    if (difficulty == null) return null
    val modes =
        BossCatalog
            .selectAll()
            .where { BossCatalog.id eq bossCatalogId }
            .firstOrNull()
            ?.get(BossCatalog.difficulties)
            .orEmpty()
    return if (difficulty in modes) null else "difficulty must be one of: ${modes.joinToString(", ")}"
}

/**
 * Why this roster cannot replace the config's seats, or null.
 *
 * A payout row is the record that somebody is owed, and it points at a seat with ON DELETE CASCADE
 * behind it, so dropping a seat the pool names would delete the record while the money stays real.
 * Refused rather than cascaded, which is what V18__party_loot.sql says this table's cascade is for:
 * the party being deleted whole, and nothing else.
 *
 * Only reachable on a save, not a create: a new config has no pool yet.
 * Must run inside a transaction.
 */
internal fun validateSeatRemovals(
    partyId: Uuid,
    ownCharacterId: Uuid,
    members: List<String>,
): String? {
    val locked = seatsWithLootHistory(partyId)
    if (locked.isEmpty()) return null
    val keeping = seatNames(ownSeatName(ownCharacterId), members).map { it.lowercase() }.toSet()
    val doomed =
        PartyMember
            .selectAll()
            .where { PartyMember.partyId eq partyId }
            .filter { it[PartyMember.id] in locked && it[PartyMember.name].lowercase() !in keeping }
            .map { it[PartyMember.name] }
    return doomed
        .takeIf { it.isNotEmpty() }
        ?.let { "cannot remove ${it.joinToString(", ")}: a drop in this pool points at them" }
}

/** The rules a config's roster has to keep, wherever it is being written. */
internal fun validateMembers(members: List<String>): String? {
    val names = members.map { it.trim() }
    return when {
        // Your own character is the config; the members are the others. Nobody else means a solo
        // run, and a solo run is not a party.
        names.isEmpty() -> "a party needs somebody else in it"
        names.size > MAX_PARTY_SIZE - 1 -> "a party holds at most $MAX_PARTY_SIZE including your character"
        names.any { it.isBlank() } -> "a member needs a character name"
        names.map { it.lowercase() }.distinct().size != names.size -> "the same character twice"
        else -> null
    }
}
