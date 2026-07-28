package com.maplestorage.backend.bosses

import com.maplestorage.backend.db.BossCatalog
import com.maplestorage.backend.db.BossClear
import com.maplestorage.backend.db.CharacterBossSkip
import com.maplestorage.backend.db.Characters
import com.maplestorage.backend.db.Party
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.upsert
import kotlin.time.Instant
import kotlin.uuid.Uuid

// Reads and writes for "this character does not run this boss". Split from BossQueries for the
// reason the table is separate from boss_clear: a clear is an answer about one period, a mark is a
// standing fact, and the rules that keep the two from contradicting each other all live here.
// `internal` like the clear queries, so the tests exercise these exact statements.
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

/** Why a skip could not be written, or null when it was. */
internal enum class SkipRefusal {
    /** Not this user's character, or not a boss in the catalog. */
    UNKNOWN,

    /**
     * A party config already says this character runs this boss.
     *
     * Refused rather than silently letting the newer write win: a config is (character, boss,
     * difficulty, who with), which is a more detailed statement of the same thing, and the two
     * cannot both be true. Deleting the config is the way to say they stopped running it.
     */
    HAS_PARTY,

    /**
     * This character has already cleared this boss in the period it is currently in.
     *
     * A clear is proof they ran it. Writing the mark anyway would store a row the matrix then has
     * to overrule to draw the clear, so the click would appear to do nothing at all.
     */
    HAS_CLEAR,
}

/**
 * Says that a character does not run a boss, or takes it back.
 *
 * No period: the row is a standing fact, and marking one does not touch this period's boss_clear.
 * A pending row underneath is left alone, so un-marking restores what the capture actually said
 * rather than a blank.
 */
internal fun setBossSkip(
    userId: String,
    characterId: Uuid,
    bossKey: String,
    skipped: Boolean,
    now: Instant,
): SkipRefusal? {
    val owned =
        Characters
            .selectAll()
            .where { (Characters.id eq characterId) and (Characters.userId eq userId) }
            .firstOrNull() != null
    val boss =
        if (!owned) null else BossCatalog.selectAll().where { BossCatalog.bossKey eq bossKey }.firstOrNull()
    if (boss == null) return SkipRefusal.UNKNOWN

    val bossCatalogId = boss[BossCatalog.id]
    // Only a mark can be refused. Taking one back cannot contradict anything, so it always writes.
    val refusal = if (skipped) skipRefusalFor(characterId, bossCatalogId, boss[BossCatalog.reset], now) else null
    if (refusal == null) {
        if (skipped) {
            CharacterBossSkip.upsert(CharacterBossSkip.characterId, CharacterBossSkip.bossCatalogId) { row ->
                row[CharacterBossSkip.characterId] = characterId
                row[CharacterBossSkip.bossCatalogId] = bossCatalogId
                row[createdAt] = now
            }
        } else {
            CharacterBossSkip.deleteWhere {
                (CharacterBossSkip.characterId eq characterId) and (CharacterBossSkip.bossCatalogId eq bossCatalogId)
            }
        }
    }
    return refusal
}

/** What already on record contradicts a "does not run" mark, or null when nothing does. */
private fun skipRefusalFor(
    characterId: Uuid,
    bossCatalogId: Uuid,
    reset: String,
    now: Instant,
): SkipRefusal? {
    val hasParty =
        Party
            .selectAll()
            .where { (Party.characterId eq characterId) and (Party.bossCatalogId eq bossCatalogId) }
            .firstOrNull() != null
    // The period the boss is in NOW. An older clear does not contradict the mark: cleared once and
    // since dropped from the rotation is the ordinary way a boss comes to be marked.
    val clearedThisPeriod =
        BossClear
            .selectAll()
            .where {
                (BossClear.characterId eq characterId) and
                    (BossClear.bossCatalogId eq bossCatalogId) and
                    (BossClear.periodStart eq periodStartFor(reset, now)) and
                    (BossClear.cleared eq true)
            }.firstOrNull() != null
    return when {
        hasParty -> SkipRefusal.HAS_PARTY
        clearedThisPeriod -> SkipRefusal.HAS_CLEAR
        else -> null
    }
}

/**
 * Drops the "does not run" mark on a boss this character has just cleared.
 *
 * A clear is proof they ran it, so the two cannot stand together and the clear is the stronger
 * statement: one is something that happened, the other is something somebody expected. Only a
 * clear does this. A pending row does not, because a planner still listing a boss says nothing
 * about whether it gets run.
 *
 * This is what keeps the read side a single lookup: a skip row present means the cell is
 * "doesn't run", with no clear to check it against.
 */
internal fun unskipCleared(
    characterId: Uuid,
    bossCatalogId: Uuid,
) = CharacterBossSkip.deleteWhere {
    (CharacterBossSkip.characterId eq characterId) and (CharacterBossSkip.bossCatalogId eq bossCatalogId)
}
