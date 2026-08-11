package com.maplestorage.backend.parties

import com.maplestorage.backend.bosses.WEEKLY_CADENCE
import com.maplestorage.backend.bosses.periodAfter
import com.maplestorage.backend.bosses.periodStartFor
import com.maplestorage.backend.bosses.weekOf
import com.maplestorage.backend.db.BossClear
import com.maplestorage.backend.db.Party
import com.maplestorage.backend.db.PartyLoot
import com.maplestorage.backend.db.PartyMember
import com.maplestorage.backend.db.PartyWeekSeat
import kotlinx.datetime.LocalDate
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.update
import kotlin.time.Clock
import kotlin.uuid.Uuid

// What each seat's share was, in a given week, and what freezes it there.
//
// `party_member.shares` is a STANDING arrangement and one value, and every unsold drop's
// entitlement is derived from it on READ (see foldSeats and entitlements). So agreeing a new split
// today re-divides every outstanding drop by it, including weeks somebody has already been shown a
// figure for. Nobody is told; the number simply changes. The roster does the same one step along: a
// week with no rows of its own reads as whoever is in the party TODAY.
//
// A week may therefore name its own shares, exactly as it can already name its own roster, and on
// the same row: party_week_seat already says "this member, in this week". See V55. One insert
// carries both facts, which is why the pin lives here beside the read. They are not pinned on the
// same terms: see pinWeeksAlreadyWritten.
//
// Beside PartyRoster.kt rather than in it, because that file answers who RAN and this answers on
// what terms. Inside a transaction, like the rest.

/**
 * The share each seat was on in [week], for the parties that named one.
 *
 * Only the weeks that spelled a share out. A seat missing here is on its standing
 * `party_member.shares`, which is every week nobody has changed the deal behind.
 */
internal fun weekSharesFor(
    partyIds: List<Uuid>,
    week: LocalDate,
): Map<Uuid, Map<Uuid, Int>> {
    if (partyIds.isEmpty()) return emptyMap()
    return PartyWeekSeat
        .selectAll()
        .where { (PartyWeekSeat.partyId inList partyIds) and (PartyWeekSeat.weekStart eq week) }
        .mapNotNull { row ->
            val shares = row[PartyWeekSeat.shares] ?: return@mapNotNull null
            Triple(row[PartyWeekSeat.partyId], row[PartyWeekSeat.memberId], shares)
        }.groupBy({ it.first }) { it.second to it.third }
        .mapValues { (_, pairs) -> pairs.toMap() }
}

/**
 * Freezes the roster as it stands onto every week already written into, and the shares onto every
 * one of those that is over.
 *
 * A config is a TEMPLATE, and that is what makes an ordinary edit reach back over nights already
 * played: swap a member in August and July's outstanding coupons re-divide, and a week somebody
 * guested in is drawn with today's party. So the weeks that have been written into keep the roster
 * they read now, and a swap applies from the first week nobody has written into.
 *
 * The two part company on the period the app is CURRENTLY in. Who ran is settled by turning up;
 * what they agreed is not. Freezing the live period made the usual order of things impossible:
 * ticking Hard Limbo cleared files its 60 guaranteed coupons on its own, which pinned the default
 * split before anybody had been asked, and no per-week share exists to correct it with (the week's
 * roster has one, see PartyRoster). So the live period takes the new deal, as V55 said it would.
 *
 * Run BEFORE the standing roster is written, or there is nothing left to pin.
 *
 * Nothing is pinned when [wanted] is what the party already says. The config's other fields (its
 * difficulty, its run time, who loots) do not move a week, and spelling one out for them would
 * claim it ran something other than the usual party.
 *
 * A past week that already named its own roster or its own shares keeps them: it has an answer, and
 * this is not it. A week nobody spelled out is spelled out now, at the roster it actually ran, which
 * is the same move pinWeeksAlreadyDropped makes and for the same reason.
 */
internal fun pinWeeksAlreadyWritten(
    partyId: Uuid,
    // The roster about to be written: each seat by lowercased name, and what it takes.
    wanted: Map<String, Int>,
) {
    if (wanted == standingSeats(partyId)) return
    val weeks = weeksAlreadyWritten(partyId)
    if (weeks.isEmpty()) return
    // The first week of the period the app is in. Every week from here on is still being played, so
    // its share is the standing one and stays that way. Off the BOSS's period rather than off this
    // week, or a monthly boss would pin the weeks of the month it is still in.
    val live = liveWeek(partyId)

    val standing =
        PartyMember
            .selectAll()
            .where { PartyMember.partyId eq partyId }
            .associate { it[PartyMember.id] to it[PartyMember.shares] }

    // What each of those weeks already says, so a week that named its own share keeps it and one
    // that did not is filled in. Decided here rather than in a WHERE clause: three states (no row,
    // a row with no share, a row with one) read plainly in Kotlin and obscurely in SQL.
    val existing =
        PartyWeekSeat
            .selectAll()
            .where { (PartyWeekSeat.partyId eq partyId) and (PartyWeekSeat.weekStart inList weeks) }
            .associate {
                (it[PartyWeekSeat.weekStart] to it[PartyWeekSeat.memberId]) to it[PartyWeekSeat.shares]
            }

    weeks.forEach { week ->
        // A week that is over. Its roster is pinned either way; only these keep the old split too.
        val over = week < live
        // The roster as that week actually ran, not every seat the party has ever had: a guest from
        // another week was not in this one, and writing them in would invent a share for a night
        // they were not on.
        rosterFor(partyId, week).forEach { seatId ->
            val key = week to seatId
            when {
                key !in existing ->
                    PartyWeekSeat.insert {
                        it[PartyWeekSeat.partyId] = partyId
                        it[weekStart] = week
                        it[memberId] = seatId
                        // NULL is the standing share, which is what a live week is on.
                        it[shares] = if (over) standing[seatId] else null
                    }
                over && existing[key] == null ->
                    PartyWeekSeat.update({
                        (PartyWeekSeat.partyId eq partyId) and
                            (PartyWeekSeat.weekStart eq week) and
                            (PartyWeekSeat.memberId eq seatId)
                    }) {
                        it[shares] = standing[seatId]
                    }
                // Already answered for, or still being played. Neither is this edit's to write.
                else -> Unit
            }
        }
    }
}

/**
 * The first week of the period this config's boss is in now.
 *
 * This week for a weekly boss and for a daily one, and the week the month opened in for a monthly:
 * a period that is still being run is still being agreed, however many weeks it covers.
 *
 * This week when the boss cannot be found, which pins nothing that is not over on any reading.
 */
private fun liveWeek(partyId: Uuid): LocalDate {
    val reset =
        Party
            .selectAll()
            .where { Party.id eq partyId }
            .firstOrNull()
            ?.let { bossResetOf(it[Party.bossCatalogId]) }
    return reset?.let { weekOf(periodStartFor(it, Clock.System.now())) } ?: currentWeek()
}

/** The party as it stands: every seat in the usual roster, by lowercased name, and what it takes. */
private fun standingSeats(partyId: Uuid): Map<String, Int> =
    PartyMember
        .selectAll()
        .where { (PartyMember.partyId eq partyId) and (PartyMember.standing eq true) }
        .associate { it[PartyMember.name].lowercase() to it[PartyMember.shares] }

/**
 * Every week this config has already been written into, up to the one the app is in now.
 *
 * Written is something DROPPED in it, or the boss ticked cleared in it. Either says the party ran,
 * and the party that ran is the one the config held at the time. A week nobody has written into is
 * still the template's to fill, which is what lets an edit made before this week's run reach it.
 *
 * Never a week after this one. A MONTHLY boss's clear covers the weeks either side of today as well
 * as today's, and freezing those would hold an edit back until the month turned over.
 */
private fun weeksAlreadyWritten(partyId: Uuid): List<LocalDate> {
    val thisWeek = currentWeek()
    return (weeksDroppedIn(partyId) + weeksClearedIn(partyId)).distinct().filter { it <= thisWeek }
}

/** The weeks this party dropped something in. */
private fun weeksDroppedIn(partyId: Uuid): List<LocalDate> =
    PartyLoot
        .selectAll()
        .where { PartyLoot.partyId eq partyId }
        .map { weekOf(it[PartyLoot.droppedOn]) }

/**
 * The weeks this config's boss was ticked cleared in, per the boss's own cadence.
 *
 * A clear is filed against a PERIOD, and only a weekly boss's period is a week. A daily one lands
 * inside a week, and a monthly one spans four or five without saying which of them the kill was in,
 * so all of them count as written rather than the pin guessing one.
 */
private fun weeksClearedIn(partyId: Uuid): List<LocalDate> {
    val config = Party.selectAll().where { Party.id eq partyId }.firstOrNull() ?: return emptyList()
    val bossId = config[Party.bossCatalogId]
    val characterId = config[Party.characterId]
    return bossResetOf(bossId)
        ?.let { reset ->
            BossClear
                .selectAll()
                .where {
                    (BossClear.characterId eq characterId) and
                        (BossClear.bossCatalogId eq bossId) and
                        (BossClear.cleared eq true)
                }.flatMap { weeksIn(reset, it[BossClear.periodStart]) }
        }.orEmpty()
}

/** The weeks a period covers, stepped by BossPeriod's own reckoning rather than a second one. */
private fun weeksIn(
    reset: String,
    periodStart: LocalDate,
): List<LocalDate> {
    val ends = periodAfter(reset, periodStart)
    return generateSequence(weekOf(periodStart)) { periodAfter(WEEKLY_CADENCE, it) }
        .takeWhile { it < ends }
        .toList()
}
