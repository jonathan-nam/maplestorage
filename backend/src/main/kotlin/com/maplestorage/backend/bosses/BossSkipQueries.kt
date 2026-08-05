package com.maplestorage.backend.bosses

import com.maplestorage.backend.db.BossCatalog
import com.maplestorage.backend.db.CharacterBossSkip
import com.maplestorage.backend.db.Characters
import com.maplestorage.backend.db.Party
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.core.notInList
import org.jetbrains.exposed.v1.jdbc.batchUpsert
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.selectAll
import kotlin.time.Instant
import kotlin.uuid.Uuid

// Reads and writes for which bosses a character runs. Split from BossQueries for the reason the
// table is separate from boss_clear: a clear is an answer about one period, a routine is a standing
// fact. `internal` like the clear queries, so the tests exercise these exact statements.
// All of these must be called from inside a `transaction { }` block.

/**
 * Which bosses each character does not run, keyed by character id.
 *
 * Standing facts, not period ones, so this takes no date. It is what lets the matrix tell "nobody
 * has said anything about Jupiter this week" from "this character never runs Jupiter": both are a
 * missing boss_clear row, and before this they were drawn the same.
 */
internal fun bossSkipsFor(userId: String): Map<String, List<String>> =
    CharacterBossSkip
        .innerJoin(BossCatalog)
        .innerJoin(Characters)
        .selectAll()
        .where { Characters.userId eq userId }
        .orderBy(BossCatalog.sortOrder)
        .groupBy({ it[CharacterBossSkip.characterId].toString() }) { it[BossCatalog.bossKey] }

/** Why a routine could not be saved, or null when it was. */
internal sealed interface RoutineRefusal {
    /** Not this user's character, or a boss key that is not in the catalog. */
    data object Unknown : RoutineRefusal

    /**
     * A party config already says this character runs these bosses.
     *
     * A config is (character, boss, difficulty, who with), which is the same claim in more detail,
     * so the two cannot both be true. Deleting the config is how you say they stopped running it.
     * The editor draws these locked, so this is a backstop rather than something a user meets.
     */
    data class HasParty(
        val bossNames: List<String>,
    ) : RoutineRefusal
}

/**
 * Replaces which bosses a character does not run, in one write.
 *
 * The whole set rather than one toggle: the editor is a checklist of every boss, so what it has to
 * say is "this is the routine now". Sent as the bosses NOT run rather than the ones that are, so a
 * boss added to the catalog since the page loaded stays unsaid instead of being silently marked as
 * one nobody runs.
 *
 * Deliberately does not touch boss_clear. A clear outranks a mark when the matrix draws a cell, so
 * a boss cleared once this week shows its tick and goes back to "doesn't run" next week, with the
 * routine left exactly as it was stated.
 */
internal fun setBossRoutine(
    userId: String,
    characterId: Uuid,
    skippedBossKeys: List<String>,
    now: Instant,
): RoutineRefusal? {
    val bosses =
        routineTargets(userId, characterId, skippedBossKeys.distinct())
            ?: return RoutineRefusal.Unknown

    val partied = partiedNames(characterId, bosses)
    val refusal = if (partied.isEmpty()) null else RoutineRefusal.HasParty(partied)
    if (refusal == null) replaceSkips(characterId, bosses.map { it.id }, now)
    return refusal
}

private data class RoutineBoss(
    val id: Uuid,
    val name: String,
)

/**
 * The catalog rows behind the keys, or null if this is not the user's character or a key is not in
 * the catalog.
 *
 * All or nothing. A key nobody named means the client and the catalog have drifted, and saving the
 * rest of the list would write a routine the user did not describe.
 */
private fun routineTargets(
    userId: String,
    characterId: Uuid,
    bossKeys: List<String>,
): List<RoutineBoss>? {
    val owned =
        Characters
            .selectAll()
            .where { (Characters.id eq characterId) and (Characters.userId eq userId) }
            .firstOrNull() != null
    if (!owned) return null

    val found =
        BossCatalog
            .selectAll()
            .where { BossCatalog.bossKey inList bossKeys }
            .map { RoutineBoss(it[BossCatalog.id], it[BossCatalog.name]) }
    return if (found.size == bossKeys.size) found else null
}

/**
 * The ones a party config already says this character runs, by name, for the refusal message.
 *
 * Solo configs do not count. One is a pool holding what fell on a boss this character ran once,
 * not a standing arrangement, and there is nothing to "remove first": the routine editor locks
 * bosses that have a party, and it reads the same list this skips.
 */
private fun partiedNames(
    characterId: Uuid,
    bosses: List<RoutineBoss>,
): List<String> {
    val ids = bosses.map { it.id }
    val partied =
        Party
            .selectAll()
            .where {
                (Party.characterId eq characterId) and (Party.bossCatalogId inList ids) and (Party.solo eq false)
            }.map { it[Party.bossCatalogId] }
            .toSet()
    return bosses.filter { it.id in partied }.map { it.name }
}

/** Replaces the character's set, since anything the checklist did not send is a boss they run. */
private fun replaceSkips(
    characterId: Uuid,
    bossCatalogIds: List<Uuid>,
    now: Instant,
) {
    CharacterBossSkip.deleteWhere {
        (CharacterBossSkip.characterId eq characterId) and
            (CharacterBossSkip.bossCatalogId notInList bossCatalogIds)
    }
    CharacterBossSkip.batchUpsert(
        bossCatalogIds,
        CharacterBossSkip.characterId,
        CharacterBossSkip.bossCatalogId,
    ) { bossCatalogId ->
        this[CharacterBossSkip.characterId] = characterId
        this[CharacterBossSkip.bossCatalogId] = bossCatalogId
        this[CharacterBossSkip.createdAt] = now
    }
}
