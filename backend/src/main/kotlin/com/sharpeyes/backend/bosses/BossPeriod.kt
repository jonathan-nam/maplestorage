package com.sharpeyes.backend.bosses

import kotlinx.datetime.DateTimeUnit
import kotlinx.datetime.LocalDate
import kotlinx.datetime.TimeZone
import kotlinx.datetime.atStartOfDayIn
import kotlinx.datetime.isoDayNumber
import kotlinx.datetime.minus
import kotlinx.datetime.plus
import kotlinx.datetime.toLocalDateTime
import kotlin.time.Instant

// Which reset period a capture counts against, as that period's start date.
//
// Reset is a QUERY BOUNDARY, not a scheduled job: a new period simply has no rows yet, so every
// boss reads pending until a capture stamps it. See V10__boss_clear.sql.

// The cadences boss_catalog.reset is CHECK-constrained to. Listed here because the current-period
// query has to ask for one date per cadence, not one date overall.
val RESET_CADENCES = listOf("WEEKLY", "DAILY", "MONTHLY")

// The cadence the week picker steps through, and the only one a past week can answer for. See
// weeklyClearsFor.
const val WEEKLY_CADENCE = "WEEKLY"

// The only cadence whose period is LONGER than a week, so the only one a week can straddle two of.
// See liveFrom.
const val MONTHLY_CADENCE = "MONTHLY"

// UTC, because that is when the game resets, not when the player is asleep. A clear captured at
// 20:00 Wednesday in Los Angeles is already Thursday in UTC and belongs to the NEW week; filing it
// in local time would put it in the week that just ended, where it reads as a second clear in a
// week the character had already finished.
private val RESET_ZONE = TimeZone.UTC

// GMS resets weekly bosses on Thursday 00:00 UTC.
//
// This is a GAME FACT and the single most dangerous number in this file: off by one day and every
// clear captured near the boundary lands in the neighbouring week, which shows up as a missed week
// sitting next to a doubled one. Neither looks like a bug, which is why it is pinned by
// BossPeriodTest rather than left as a comment to be trusted.
private const val WEEKLY_RESET_ISO_DAY = 4 // Monday is 1, so Thursday is 4.

private const val DAYS_IN_WEEK = 7

/**
 * The period a capture belongs to, per the boss's own cadence.
 *
 * Callers pass `boss_catalog.reset` straight through. An unknown value is an error rather than a
 * fallback: the column is CHECK-constrained, so reaching the else branch means the catalog and
 * this code have drifted, and guessing a period would file real clears against a made-up week.
 */
fun periodStartFor(
    reset: String,
    capturedAt: Instant,
): LocalDate {
    val date = capturedAt.toLocalDateTime(RESET_ZONE).date
    return when (reset) {
        "DAILY" -> date
        "WEEKLY" -> date.minus(daysSinceWeeklyReset(date), DateTimeUnit.DAY)
        "MONTHLY" -> LocalDate(date.year, date.month, 1)
        else ->
            error(
                "Unknown boss reset cadence '$reset'. boss_catalog.reset is constrained to " +
                    "WEEKLY/DAILY/MONTHLY (see V10__boss_clear.sql), so this means the catalog " +
                    "and BossPeriod have drifted.",
            )
    }
}

// 0 on reset day itself, counting up to 6 the day before the next one. Adding a whole week before
// the modulo is what keeps it non-negative for the days that sit before Thursday in the ISO week.
private fun daysSinceWeeklyReset(date: LocalDate): Int =
    (date.dayOfWeek.isoDayNumber - WEEKLY_RESET_ISO_DAY + DAYS_IN_WEEK) % DAYS_IN_WEEK

/**
 * The period a DATE falls in, per the boss's own cadence.
 *
 * The same boundary periodStartFor draws, so the period a drop is filed under and the one the
 * picker steps cannot come apart. A drop's date is already the UTC day it fell on, so opening it
 * at midnight UTC re-enters this file's own reckoning rather than a second one.
 */
fun periodOf(
    reset: String,
    date: LocalDate,
): LocalDate = periodStartFor(reset, date.atStartOfDayIn(RESET_ZONE))

/** The week a date falls in, as that week's start. periodOf, for the cadence a roster is kept by. */
fun weekOf(date: LocalDate): LocalDate = periodOf(WEEKLY_CADENCE, date)

/** The period after this one, for a cadence. Stepping the week picker back and forth goes through here. */
fun periodAfter(
    reset: String,
    periodStart: LocalDate,
): LocalDate =
    when (reset) {
        "DAILY" -> periodStart.plus(1, DateTimeUnit.DAY)
        "WEEKLY" -> periodStart.plus(DAYS_IN_WEEK, DateTimeUnit.DAY)
        "MONTHLY" -> periodStart.plus(1, DateTimeUnit.MONTH)
        else -> error("Unknown boss reset cadence '$reset'. See periodStartFor.")
    }

fun periodBefore(
    reset: String,
    periodStart: LocalDate,
): LocalDate =
    when (reset) {
        "DAILY" -> periodStart.minus(1, DateTimeUnit.DAY)
        "WEEKLY" -> periodStart.minus(DAYS_IN_WEEK, DateTimeUnit.DAY)
        "MONTHLY" -> periodStart.minus(1, DateTimeUnit.MONTH)
        else -> error("Unknown boss reset cadence '$reset'. See periodStartFor.")
    }

/**
 * When the cadence next rolls over, as an instant.
 *
 * Derived from periodStartFor rather than computed separately, so the countdown the page shows and
 * the boundary a clear is filed against can never disagree. A timer that ticks to zero while the
 * matrix still reads last week would be the same wrong-number failure wearing a clock.
 */
fun nextResetAfter(
    reset: String,
    now: Instant,
): Instant = periodAfter(reset, periodStartFor(reset, now)).atStartOfDayIn(RESET_ZONE)

/** Where the week picker may step from the week it is showing. Null means the arrow is at an end. */
data class WeekNavigation(
    val previous: LocalDate?,
    val next: LocalDate?,
)

/**
 * Which way the picker can step.
 *
 * Both ends are bounded rather than open. Back stops at the oldest stored week because everything
 * before it renders as a blank matrix, which is indistinguishable from a week where nothing was
 * cleared; forward stops at the week in progress because there is nothing to say about a week that
 * has not happened.
 */
fun weekNavigation(
    shown: LocalDate,
    currentWeek: LocalDate,
    earliest: LocalDate?,
): WeekNavigation =
    WeekNavigation(
        previous = periodBefore(WEEKLY_CADENCE, shown).takeIf { earliest != null && it >= earliest },
        next = periodAfter(WEEKLY_CADENCE, shown).takeIf { it <= currentWeek },
    )

/**
 * Whether a date is a real start for this cadence, i.e. it is the period it belongs to.
 *
 * The week picker takes a date from the query string. A Tuesday would otherwise select nothing and
 * render an empty matrix that looks exactly like a week with no captures.
 */
fun isPeriodStart(
    reset: String,
    date: LocalDate,
): Boolean = periodStartFor(reset, date.atStartOfDayIn(RESET_ZONE)) == date

/**
 * A `?week=` query parameter, parsed. Absent is the live view, so null succeeds.
 *
 * Off-boundary and malformed both fail rather than falling back to the live week. Every endpoint
 * that takes this serves a week's worth of counts, and answering a Tuesday with some neighbouring
 * week's numbers is the confidently wrong answer, not the empty one. Shared by the clears and the
 * party list so the two cannot come to disagree about which dates are weeks.
 */
fun parseWeekParam(raw: String?): Result<LocalDate?> {
    if (raw == null) return Result.success(null)
    val parsed = runCatching { LocalDate.parse(raw) }.getOrNull()
    val refusal =
        when {
            parsed == null -> "malformed week, expected YYYY-MM-DD"
            !isPeriodStart(WEEKLY_CADENCE, parsed) -> "week must be a reset day (Thursday, UTC)"
            else -> null
        }
    return refusal?.let { Result.failure(IllegalArgumentException(it)) } ?: Result.success(parsed)
}
