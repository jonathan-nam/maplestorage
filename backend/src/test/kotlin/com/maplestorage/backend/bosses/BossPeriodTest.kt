package com.maplestorage.backend.bosses

import kotlinx.datetime.LocalDate
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
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
    fun `an unknown cadence is loud rather than guessed`() {
        // boss_catalog.reset is CHECK-constrained, so this can only happen through drift. Guessing
        // a period here would file real clears against a week that does not exist.
        assertFailsWith<IllegalStateException> { periodStartFor("FORTNIGHTLY", at("2026-07-18T12:00:00Z")) }
    }
}
