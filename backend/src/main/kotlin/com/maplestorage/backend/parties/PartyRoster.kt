package com.maplestorage.backend.parties

import com.maplestorage.backend.bosses.WEEKLY_CADENCE
import com.maplestorage.backend.bosses.periodStartFor
import com.maplestorage.backend.db.PartyMember
import com.maplestorage.backend.db.PartyWeekSeat
import kotlinx.datetime.LocalDate
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.selectAll
import kotlin.time.Clock
import kotlin.uuid.Uuid

// Who ran, in a given week.
//
// One question with one answer, and everything asks it here: the party list, the loot pool's
// payouts, and the seller a sale may name. A second implementation of "who was in this party" is
// how a payout roster and the roster on screen come to disagree, which is a wrong number wearing
// the right party's name.
//
// Inside a transaction, like the rest.

/** The week the app is in now, which is what a caller means by "this week". */
internal fun currentWeek(): LocalDate = periodStartFor(WEEKLY_CADENCE, Clock.System.now())

/**
 * The seats each party ran with in [week], in seat order.
 *
 * A week with rows in party_week_seat ran exactly those. A week with none ran the standing roster,
 * which is most weeks and is why the absence of rows is the answer rather than a missing one.
 */
internal fun rostersFor(
    partyIds: List<Uuid>,
    week: LocalDate,
): Map<Uuid, List<Uuid>> {
    if (partyIds.isEmpty()) return emptyMap()

    val seatOrder =
        PartyMember
            .selectAll()
            .where { PartyMember.partyId inList partyIds }
            .orderBy(PartyMember.position)
            .map { Triple(it[PartyMember.partyId], it[PartyMember.id], it[PartyMember.standing]) }

    val overridden =
        PartyWeekSeat
            .selectAll()
            .where { (PartyWeekSeat.partyId inList partyIds) and (PartyWeekSeat.weekStart eq week) }
            .groupBy({ it[PartyWeekSeat.partyId] }) { it[PartyWeekSeat.memberId] }
            .mapValues { (_, ids) -> ids.toSet() }

    return partyIds.associateWith { partyId ->
        val seats = seatOrder.filter { it.first == partyId }
        val thisWeek = overridden[partyId]
        // Ordered by the seat's own position either way, so a week's roster is not shuffled by the
        // order rows happened to come back in.
        seats.filter { if (thisWeek == null) it.third else it.second in thisWeek }.map { it.second }
    }
}

/** One party's roster for a week. */
internal fun rosterFor(
    partyId: Uuid,
    week: LocalDate,
): List<Uuid> = rostersFor(listOf(partyId), week)[partyId].orEmpty()

/**
 * Which of these parties had [week] spelled out, rather than running the usual roster.
 *
 * What tells "the usual party, which happens to be these three" from "these three, this week". The
 * roster alone cannot: a week that only drops somebody names no guest, and would read as usual.
 */
internal fun weeksSpelledOut(
    partyIds: List<Uuid>,
    week: LocalDate,
): Set<Uuid> {
    if (partyIds.isEmpty()) return emptySet()
    return PartyWeekSeat
        .selectAll()
        .where { (PartyWeekSeat.partyId inList partyIds) and (PartyWeekSeat.weekStart eq week) }
        .map { it[PartyWeekSeat.partyId] }
        .toSet()
}

/** The seats any week of this party names, so one a week still needs is retired and not deleted. */
internal fun seatsInAnyWeekRoster(partyId: Uuid): Set<Uuid> =
    PartyWeekSeat
        .selectAll()
        .where { PartyWeekSeat.partyId eq partyId }
        .map { it[PartyWeekSeat.memberId] }
        .toSet()

/**
 * Says who ran this week, or puts the week back to the usual party.
 *
 * A null [members] deletes the week's rows, which is what makes going back to normal a deletion
 * rather than a second roster to keep in step, and what makes next week revert without being told.
 *
 * Otherwise the names ARE the week: a usual member not among them is out for it, and a character
 * the party has never sat gets a seat of their own with standing = false. That seat is what a
 * payout can point at, which is the whole reason a guest is a seat and not a name on a list.
 *
 * The party's own roster is untouched either way. That is the point of the feature.
 *
 * Written here rather than in PartyWrites.kt, beside the read: "no rows means the usual roster" is
 * one rule, and putting it in one file and its inverse in another is how the two come apart.
 */
internal fun saveWeekRoster(
    partyId: Uuid,
    ownCharacterId: Uuid,
    week: LocalDate,
    members: List<String>?,
    context: SeatContext,
) {
    PartyWeekSeat.deleteWhere { (PartyWeekSeat.partyId eq partyId) and (PartyWeekSeat.weekStart eq week) }
    if (members == null) return

    val existing = seatIdsByName(partyId)
    // After every seat the party already has, so a guest does not take a usual member's place in
    // the order and shuffle the roster strip on the weeks they are not in.
    var nextPosition = existing.size
    val mine = ownCharacterIds(context.userId)

    seatNames(ownSeatName(ownCharacterId), members).forEach { name ->
        val seatId =
            existing[name.lowercase()]
                ?: insertSeat(partyId, name, mine[name.lowercase()], nextPosition++, isStanding = false, context)
        PartyWeekSeat.insert {
            it[PartyWeekSeat.partyId] = partyId
            it[weekStart] = week
            it[memberId] = seatId
        }
    }
}
