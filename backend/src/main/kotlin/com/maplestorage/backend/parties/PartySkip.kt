package com.maplestorage.backend.parties

import com.maplestorage.backend.bosses.periodOf
import com.maplestorage.backend.bosses.periodStartFor
import com.maplestorage.backend.db.BossCatalog
import com.maplestorage.backend.db.Party
import com.maplestorage.backend.db.PartyPeriodSkip
import kotlinx.datetime.LocalDate
import org.jetbrains.exposed.v1.core.ResultRow
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insertIgnore
import org.jetbrains.exposed.v1.jdbc.selectAll
import kotlin.time.Instant
import kotlin.uuid.Uuid

// A period the party is not running, the config left standing. Held apart from PartyRoster.kt
// because the two answer different questions and are kept by different clocks: a roster is who ran
// in a Thursday week, this is whether the boss was run at all in the period the boss is answered
// for. See V31__party_period_skip.sql.
//
// Inside a transaction, like the rest.

/**
 * The period a view is asking about, for a boss on this cadence.
 *
 * The live view is the period the boss is in NOW, which for a monthly boss is not the month the
 * current Thursday started in: on the first days of a month those two disagree, and answering with
 * the week's month would draw last month's mark over this one.
 *
 * A past week is that week for a weekly boss, and the month around it for a monthly one. Party View
 * drops monthly configs from a history view anyway, so that second case is a coherent answer rather
 * than one anything currently reads.
 */
internal fun periodShown(
    reset: String,
    week: LocalDate?,
    now: Instant,
): LocalDate = if (week == null) periodStartFor(reset, now) else periodOf(reset, week)

/**
 * Which of these configs are marked not-running in the period [week] is asking about.
 *
 * Per boss, because cadences differ, the same reason clearStateFor keys by period rather than
 * filtering on one date: a weekly and a monthly boss are in different periods at the same instant.
 *
 * [rows] are joined Party ⨝ BossCatalog rows, as partiesFor already has them.
 */
internal fun periodSkipsFor(
    rows: List<ResultRow>,
    week: LocalDate?,
    now: Instant,
): Set<Uuid> {
    if (rows.isEmpty()) return emptySet()
    val wanted = rows.associate { it[Party.id] to periodShown(it[BossCatalog.reset], week, now) }

    return PartyPeriodSkip
        .selectAll()
        .where { PartyPeriodSkip.partyId inList wanted.keys.toList() }
        .filter { it[PartyPeriodSkip.periodStart] == wanted[it[PartyPeriodSkip.partyId]] }
        .map { it[PartyPeriodSkip.partyId] }
        .toSet()
}

/** Whether this one config is marked not-running in [period]. */
internal fun isPeriodSkipped(
    partyId: Uuid,
    period: LocalDate,
): Boolean =
    PartyPeriodSkip
        .selectAll()
        .where { (PartyPeriodSkip.partyId eq partyId) and (PartyPeriodSkip.periodStart eq period) }
        .empty()
        .not()

/**
 * Marks this period not-running, or puts it back.
 *
 * Putting it back is a deletion rather than a row saying false, which is what makes the next period
 * run as usual without being told to. Same shape as saveWeekRoster.
 *
 * insertIgnore because saying it twice is saying it once: the PK already holds the invariant, and a
 * second click should not be an error the user has to read.
 */
internal fun setPeriodSkip(
    partyId: Uuid,
    period: LocalDate,
    skipped: Boolean,
    now: Instant,
) {
    if (!skipped) {
        PartyPeriodSkip.deleteWhere {
            (PartyPeriodSkip.partyId eq partyId) and (PartyPeriodSkip.periodStart eq period)
        }
        return
    }
    PartyPeriodSkip.insertIgnore {
        it[PartyPeriodSkip.partyId] = partyId
        it[periodStart] = period
        it[createdAt] = now
    }
}
