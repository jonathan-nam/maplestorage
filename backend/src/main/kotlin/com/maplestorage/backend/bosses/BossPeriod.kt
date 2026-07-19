package com.maplestorage.backend.bosses

import kotlinx.datetime.DateTimeUnit
import kotlinx.datetime.LocalDate
import kotlinx.datetime.TimeZone
import kotlinx.datetime.isoDayNumber
import kotlinx.datetime.minus
import kotlinx.datetime.toLocalDateTime
import kotlin.time.Instant

// Which reset period a capture counts against, as that period's start date.
//
// Reset is a QUERY BOUNDARY, not a scheduled job: a new period simply has no rows yet, so every
// boss reads pending until a capture stamps it. See V10__boss_clear.sql.

// The cadences boss_catalog.reset is CHECK-constrained to. Listed here because the current-period
// query has to ask for one date per cadence, not one date overall.
val RESET_CADENCES = listOf("WEEKLY", "DAILY", "MONTHLY")

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
