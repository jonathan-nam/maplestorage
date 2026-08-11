package com.maplestorage.backend.parties

import com.maplestorage.backend.bosses.weekOf
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
import kotlin.uuid.Uuid

// What each seat's share was, in a given week.
//
// `party_member.shares` is a STANDING arrangement and one value, and every unsold drop's
// entitlement is derived from it on READ (see foldSeats and entitlements). So agreeing a new split
// today re-divides every outstanding drop by it, including weeks somebody has already been shown a
// figure for. Nobody is told; the number simply changes.
//
// A week may therefore name its own shares, exactly as it can already name its own roster, and on
// the same row: party_week_seat already says "this member, in this week". See V55.
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
 * Freezes the CURRENT shares onto every week before [from] that already holds a drop.
 *
 * What makes a new deal apply from now on rather than backwards. Run BEFORE the standing value is
 * written, or there is nothing left to pin.
 *
 * A week that already named its own shares is left alone: it has an answer, and this is not it. A
 * week nobody spelled out is spelled out now, at the roster it actually ran, which is the same move
 * pinWeeksAlreadyDropped makes and for the same reason.
 */
internal fun pinSharesBefore(
    partyId: Uuid,
    from: LocalDate,
) {
    val weeks = weeksWithDropsBefore(partyId, from)
    if (weeks.isEmpty()) return

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
                        it[shares] = standing[seatId]
                    }
                existing[key] == null ->
                    PartyWeekSeat.update({
                        (PartyWeekSeat.partyId eq partyId) and
                            (PartyWeekSeat.weekStart eq week) and
                            (PartyWeekSeat.memberId eq seatId)
                    }) {
                        it[shares] = standing[seatId]
                    }
                // Already answered for. Its share is that week's own, and this is not it.
                else -> Unit
            }
        }
    }
}

/** The weeks this party dropped something in, before [from]. The only weeks a pin can matter to. */
private fun weeksWithDropsBefore(
    partyId: Uuid,
    from: LocalDate,
): List<LocalDate> =
    PartyLoot
        .selectAll()
        .where { PartyLoot.partyId eq partyId }
        .map { weekOf(it[PartyLoot.droppedOn]) }
        .distinct()
        .filter { it < from }
