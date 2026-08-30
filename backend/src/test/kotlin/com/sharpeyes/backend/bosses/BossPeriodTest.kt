package com.sharpeyes.backend.bosses

import kotlinx.datetime.LocalDate
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.time.Instant

// The reset boundary decides which week a clear counts against, and getting it wrong is invisible:
// a clear filed one period early reads as a missed week beside a doubled one, and both look like
// ordinary play. So the boundary is pinned here rather than trusted to the comment in BossPeriod.
//
// Truth is the calendar. 2026-07-16 is a Thursday, which makes it a GMS weekly reset day.
class BossPeriodTest {
    private fun at(iso: String) = Instant.parse(iso)

    @Test
    fun `a weekly clear on reset day starts its own period`() {
        assertEquals(LocalDate(2026, 7, 16), periodStartFor("WEEKLY", at("2026-07-16T00:00:00Z")))
        assertEquals(LocalDate(2026, 7, 16), periodStartFor("WEEKLY", at("2026-07-16T23:59:59Z")))
    }

    @Test
    fun `the six days after reset all belong to that reset`() {
        val expected = LocalDate(2026, 7, 16)
        for (day in 16..22) {
            assertEquals(expected, periodStartFor("WEEKLY", at("2026-07-${day}T12:00:00Z")), "July $day")
        }
    }

    @Test
    fun `the instant before reset still belongs to the week that is ending`() {
        // 23:59:59 Wednesday is the last second of the old week; one second later is a new one.
        assertEquals(LocalDate(2026, 7, 9), periodStartFor("WEEKLY", at("2026-07-15T23:59:59Z")))
        assertEquals(LocalDate(2026, 7, 16), periodStartFor("WEEKLY", at("2026-07-16T00:00:00Z")))
    }

    @Test
    fun `the boundary is UTC, not the player's evening`() {
        // 20:00 Wednesday in Los Angeles is 03:00 Thursday UTC: the game has already reset, so this
        // belongs to the NEW week. Filing it in local time would put a fresh clear into the week
        // the character had just finished, where it reads as a second clear.
        assertEquals(LocalDate(2026, 7, 16), periodStartFor("WEEKLY", at("2026-07-16T03:00:00Z")))
    }

    @Test
    fun `daily is the UTC date and monthly is the first of the month`() {
        assertEquals(LocalDate(2026, 7, 18), periodStartFor("DAILY", at("2026-07-18T12:00:00Z")))
        assertEquals(LocalDate(2026, 7, 19), periodStartFor("DAILY", at("2026-07-19T00:00:00Z")))
        assertEquals(LocalDate(2026, 7, 1), periodStartFor("MONTHLY", at("2026-07-18T12:00:00Z")))
        assertEquals(LocalDate(2026, 8, 1), periodStartFor("MONTHLY", at("2026-08-01T00:00:00Z")))
    }

    @Test
    fun `one capture puts bosses of different cadences in different periods`() {
        // The reason the current-period query asks for a date per cadence rather than one date: at
        // any instant a weekly and a daily boss are in periods that start on different days.
        val now = at("2026-07-18T12:00:00Z")
        assertEquals(LocalDate(2026, 7, 16), periodStartFor("WEEKLY", now))
        assertEquals(LocalDate(2026, 7, 18), periodStartFor("DAILY", now))
        assertEquals(LocalDate(2026, 7, 1), periodStartFor("MONTHLY", now))
    }

    @Test
    fun `the next reset is the start of the next period`() {
        // The countdown's whole job. Derived from periodStartFor, so a clear filed against the new
        // week and a timer that has just hit zero can never disagree.
        val saturday = at("2026-07-18T12:00:00Z")
        assertEquals(at("2026-07-23T00:00:00Z"), nextResetAfter("WEEKLY", saturday))
        assertEquals(at("2026-07-19T00:00:00Z"), nextResetAfter("DAILY", saturday))
        assertEquals(at("2026-08-01T00:00:00Z"), nextResetAfter("MONTHLY", saturday))
    }

    @Test
    fun `on reset day the weekly countdown is a full week, not zero`() {
        // The off-by-one that would show "0h" all Thursday: a period that has just begun ends in
        // seven days, and the instant of reset itself belongs to the period it opens.
        assertEquals(at("2026-07-23T00:00:00Z"), nextResetAfter("WEEKLY", at("2026-07-16T00:00:00Z")))
        assertEquals(at("2026-07-23T00:00:00Z"), nextResetAfter("WEEKLY", at("2026-07-22T23:59:59Z")))
    }

    @Test
    fun `stepping a week back and forward returns to where it started`() {
        val week = LocalDate(2026, 7, 16)
        assertEquals(LocalDate(2026, 7, 9), periodBefore("WEEKLY", week))
        assertEquals(LocalDate(2026, 7, 23), periodAfter("WEEKLY", week))
        assertEquals(week, periodAfter("WEEKLY", periodBefore("WEEKLY", week)))
    }

    @Test
    fun `stepping weeks crosses a month and a year without drifting off Thursday`() {
        // Date arithmetic, not day-of-month arithmetic. Every step must still land on a reset day.
        var week = LocalDate(2026, 12, 3)
        repeat(10) {
            week = periodAfter("WEEKLY", week)
            assertTrue(isPeriodStart("WEEKLY", week), "$week should still be a Thursday")
        }
        assertEquals(LocalDate(2027, 2, 11), week)
    }

    @Test
    fun `only a real period start is a period start`() {
        // Guards the query-string check. A Tuesday selects no rows, and an empty matrix reads
        // exactly like a week nobody captured.
        assertTrue(isPeriodStart("WEEKLY", LocalDate(2026, 7, 16)))
        assertFalse(isPeriodStart("WEEKLY", LocalDate(2026, 7, 17)))
        assertTrue(isPeriodStart("MONTHLY", LocalDate(2026, 7, 1)))
        assertFalse(isPeriodStart("MONTHLY", LocalDate(2026, 7, 2)))
        assertTrue(isPeriodStart("DAILY", LocalDate(2026, 7, 17)))
    }

    @Test
    fun `the picker stops at the oldest stored week and at the week in progress`() {
        val current = LocalDate(2026, 7, 16)
        val earliest = LocalDate(2026, 6, 25)

        // Sitting on the current week: nowhere forward to go, history behind.
        val atCurrent = weekNavigation(current, current, earliest)
        assertNull(atCurrent.next, "there is nothing to say about a week that has not happened")
        assertEquals(LocalDate(2026, 7, 9), atCurrent.previous)

        // Sitting on the oldest stored week: nowhere further back.
        val atEarliest = weekNavigation(earliest, current, earliest)
        assertNull(atEarliest.previous, "everything before the oldest capture is a blank matrix")
        assertEquals(LocalDate(2026, 7, 2), atEarliest.next)
    }

    @Test
    fun `stepping forward from the week before current lands on the current week`() {
        // The client needs this to equal currentWeekStart so it can go to the live view instead of
        // asking for a weekly-only slice of the current week, which would drop daily and monthly.
        val current = LocalDate(2026, 7, 16)
        assertEquals(current, weekNavigation(LocalDate(2026, 7, 9), current, LocalDate(2026, 1, 1)).next)
    }

    @Test
    fun `a user with nothing captured cannot step back at all`() {
        val current = LocalDate(2026, 7, 16)
        assertNull(weekNavigation(current, current, null).previous)
    }

    @Test
    fun `an unknown cadence is loud rather than guessed`() {
        // boss_catalog.reset is CHECK-constrained, so this can only happen through drift. Guessing
        // a period here would file real clears against a week that does not exist.
        assertFailsWith<IllegalStateException> { periodStartFor("FORTNIGHTLY", at("2026-07-18T12:00:00Z")) }
    }
}
