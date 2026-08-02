package com.maplestorage.backend.parties

import com.maplestorage.backend.db.BossCatalog
import com.maplestorage.backend.db.Characters
import com.maplestorage.backend.db.Party
import com.maplestorage.backend.db.PartyMember
import kotlinx.datetime.LocalDate
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
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
        else ->
            validateDifficulty(bossCatalogId, request.difficulty)
                ?: validateMinutes(request.minutes)
                ?: validateMembers(request.members)
                ?: validateBossRoster(userId, bossCatalogId, exclude = null, rosterOf(characterId, request.members))
    }
}

/**
 * Why this week's roster cannot stand against the boss's other configs, or null.
 *
 * The same rule as validateBossRoster, against who actually RAN rather than the usual roster, which
 * is the one thing a week can say that a config cannot. Read through rostersFor on purpose: a party
 * that dropped somebody this week is not holding their clear, so lending them to another party for
 * the same boss is allowed, and only checking the standing rosters would refuse it.
 *
 * Must run inside a transaction.
 */
internal fun validateWeekRoster(
    userId: String,
    bossCatalogId: Uuid,
    exclude: Uuid,
    week: LocalDate,
    roster: List<String>,
): String? {
    val wanted = roster.map { it.trim().lowercase() }.toSet()
    val ownerOf =
        if (wanted.isEmpty()) {
            emptyMap()
        } else {
            Party
                .selectAll()
                .where { (Party.userId eq userId) and (Party.bossCatalogId eq bossCatalogId) }
                .filter { it[Party.id] != exclude }
                .associate { it[Party.id] to it[Party.characterId] }
        }

    val ran = if (ownerOf.isEmpty()) emptyList() else rostersFor(ownerOf.keys.toList(), week).values.flatten()
    val clash =
        if (ran.isEmpty()) {
            null
        } else {
            PartyMember
                .selectAll()
                .where { PartyMember.id inList ran }
                .firstOrNull { it[PartyMember.name].trim().lowercase() in wanted }
        }

    return clash?.let {
        val owner = ownerOf[it[PartyMember.partyId]]?.let(::characterName)
        "${it[PartyMember.name]} already ran this boss with your $owner party this week"
    }
}

/** A config's seats as one list: your character, then the people it runs the boss with. */
internal fun rosterOf(
    characterId: Uuid?,
    members: List<String>,
): List<String> = listOfNotNull(characterId?.let(::characterName)) + members

private fun characterName(characterId: Uuid): String? =
    Characters
        .selectAll()
        .where { Characters.id eq characterId }
        .firstOrNull()
        ?.get(Characters.name)

/**
 * Why this run time cannot be stored, or null.
 *
 * Null passes, meaning nobody has timed this party. Zero passes too: a boss walked through in
 * under a minute is a real thing to say, and rounding it up to "at least one" would be this app
 * disagreeing with the person who timed it.
 *
 * The ceiling is a typo guard, not a rule about bossing. Refusing rather than clamping, because a
 * 3000 silently kept as 600 would order somebody's night around a number they never entered.
 */
internal fun validateMinutes(minutes: Int?): String? =
    when {
        minutes == null -> null
        minutes < 0 -> "minutes cannot be negative"
        minutes > MAX_RUN_MINUTES -> "minutes must be at most $MAX_RUN_MINUTES"
        else -> null
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
 * Why this roster cannot stand against the boss's other configs, or null.
 *
 * A character clears a boss once a period, so naming one in two configs for the same boss states
 * something the game cannot do: only one of the two can ever run. Run Order had to drop one of them
 * and could say nothing useful about which, so the pair is refused at the point it is written.
 *
 * `exclude` is the config being edited, which is not competition with itself.
 *
 * Owner and members are one list here. A character occupies its slot whichever end of a config it
 * sits at, and letting it own one config and sit in another for the same boss is the same clash
 * through a different door.
 *
 * Must run inside a transaction.
 */
internal fun validateBossRoster(
    userId: String,
    bossCatalogId: Uuid,
    exclude: Uuid?,
    roster: List<String>,
): String? {
    val wanted = roster.map { it.trim().lowercase() }.toSet()

    // Every seat this account already has on this boss. Compared in Kotlin rather than SQL: it is a
    // handful of rows per boss, and the case-folding then matches validateMembers' rather than
    // Postgres's collation.
    val clash =
        if (wanted.isEmpty()) {
            null
        } else {
            PartyMember
                .innerJoin(Party)
                .selectAll()
                .where { (Party.userId eq userId) and (Party.bossCatalogId eq bossCatalogId) }
                .filter { exclude == null || it[Party.id] != exclude }
                .firstOrNull { it[PartyMember.name].trim().lowercase() in wanted }
        }

    return clash?.let {
        "${it[PartyMember.name]} is already in your ${characterName(it[Party.characterId])} party for this boss"
    }
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
