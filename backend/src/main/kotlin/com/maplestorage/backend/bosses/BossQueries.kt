package com.maplestorage.backend.bosses

import com.maplestorage.backend.db.BossCatalog
import com.maplestorage.backend.db.BossClear
import com.maplestorage.backend.db.Characters
import com.maplestorage.backend.services.DetectedBossClear
import kotlinx.datetime.LocalDate
import org.jetbrains.exposed.v1.core.ResultRow
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.min
import org.jetbrains.exposed.v1.core.or
import org.jetbrains.exposed.v1.jdbc.select
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.upsert
import kotlin.time.Instant
import kotlin.uuid.Uuid

// Reads and writes for boss clears. `internal` rather than private, like tokenTotalsFor, so the
// tests can exercise these exact queries without standing up Ktor and a JWT.
// All of these must be called from inside a `transaction { }` block.

internal fun bossCatalog(): List<BossResponse> =
    BossCatalog
        .selectAll()
        .orderBy(BossCatalog.sortOrder)
        .map { BossResponse(it[BossCatalog.bossKey], it[BossCatalog.name], it[BossCatalog.reset]) }

/**
 * Every character's clears for the period each boss is currently in, keyed by character id.
 *
 * "Currently" is per boss, not per account: a weekly and a daily boss are in different periods at
 * the same instant, so this asks for one date per cadence rather than filtering on a single one.
 * Filtering on one date would silently return the daily bosses' rows only on the weekly reset day.
 *
 * A boss with no row is absent rather than false. Absent means "no capture has said anything about
 * this boss this period", which is not the same as "not cleared", and only the client showing the
 * matrix can decide how to draw the difference.
 */
internal fun currentBossClearsFor(
    userId: String,
    now: Instant,
): Map<String, List<BossClearResponse>> {
    val currentPeriod = RESET_CADENCES.associateWith { periodStartFor(it, now) }
    return BossClear
        .innerJoin(BossCatalog)
        .innerJoin(Characters)
        .selectAll()
        .where {
            // Scope to this user's characters. Without it the join reaches every user's rows.
            (Characters.userId eq userId) and
                currentPeriod.entries
                    .map { (reset, start) -> (BossCatalog.reset eq reset) and (BossClear.periodStart eq start) }
                    .reduce { a, b -> a or b }
        }.orderBy(BossCatalog.sortOrder)
        .groupBy({ it[BossClear.characterId].toString() }) { it.toBossClearResponse() }
}

/**
 * One past week's clears, weekly bosses only.
 *
 * Weekly only, and that is a correctness choice rather than a shortcut. A week contains seven daily
 * periods, so there is no single answer to "was Zakum cleared that week" to put in a cell; and a
 * week can straddle two months, so the monthly boss has no unambiguous one either. Returning
 * something for them would mean picking one of several true answers and drawing it as if it were
 * the only one. The page hides both cadences when it is showing history.
 */
internal fun weeklyClearsFor(
    userId: String,
    weekStart: LocalDate,
): Map<String, List<BossClearResponse>> =
    BossClear
        .innerJoin(BossCatalog)
        .innerJoin(Characters)
        .selectAll()
        .where {
            (Characters.userId eq userId) and
                (BossCatalog.reset eq WEEKLY_CADENCE) and
                (BossClear.periodStart eq weekStart)
        }.orderBy(BossCatalog.sortOrder)
        .groupBy({ it[BossClear.characterId].toString() }) { it.toBossClearResponse() }

/**
 * The oldest week this user has any weekly clear stored for, or null if they have none.
 *
 * Bounds the back arrow. Without it the picker would step forever into weeks that were never
 * captured, which read identically to a week where nothing was cleared.
 */
internal fun earliestWeekStartFor(userId: String): LocalDate? {
    val earliest = BossClear.periodStart.min()
    return BossClear
        .innerJoin(BossCatalog)
        .innerJoin(Characters)
        .select(earliest)
        .where { (Characters.userId eq userId) and (BossCatalog.reset eq WEEKLY_CADENCE) }
        .firstOrNull()
        ?.get(earliest)
}

private fun ResultRow.toBossClearResponse() =
    BossClearResponse(
        bossKey = this[BossCatalog.bossKey],
        cleared = this[BossClear.cleared],
        periodStart = this[BossClear.periodStart].toString(),
        capturedAt = this[BossClear.capturedAt].toString(),
    )

/**
 * Files a planner read against the character it belongs to.
 *
 * Pending rows are written too, not only clears: a planner shows every boss the character runs
 * with its state, so a (boss, period, cleared=false) row IS that character's routine, and without
 * it "pending" would be indistinguishable from "never seen". See V10__boss_clear.sql.
 */
internal fun upsertBossClears(
    characterId: Uuid,
    clears: List<DetectedBossClear>,
    screenshotId: Uuid,
    capturedAt: Instant,
) {
    if (clears.isEmpty()) return
    val catalog = BossCatalog.selectAll().associateBy { it[BossCatalog.bossKey] }
    for (clear in clears) {
        // The reader can only emit a key it matched against the generated catalog, the same
        // manifest boss_catalog is seeded from, so an unmatched one means the two have drifted.
        // Loud, for the reason upsertTokenCounts is loud: the silent version of this dropped
        // every token when the parser changed its key format and no test noticed.
        val row =
            catalog[clear.bossKey]
                ?: error(
                    "No boss_catalog row with boss_key='${clear.bossKey}'. The planner reader " +
                        "and the catalog have drifted. See catalog/bosses.yaml.",
                )
        // Per boss, because cadences differ: a daily and a weekly boss read from one capture
        // belong to two different periods.
        val period = periodStartFor(row[BossCatalog.reset], capturedAt)
        BossClear.upsert(BossClear.characterId, BossClear.bossCatalogId, BossClear.periodStart) { r ->
            r[BossClear.characterId] = characterId
            r[bossCatalogId] = row[BossCatalog.id]
            r[periodStart] = period
            r[cleared] = clear.cleared
            r[BossClear.capturedAt] = capturedAt
            r[sourceScreenshotId] = screenshotId
        }
    }
}
