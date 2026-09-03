package com.sharpeyes.backend.parties

import com.sharpeyes.backend.bosses.weekOf
import com.sharpeyes.backend.db.PartyMember
import kotlinx.datetime.LocalDate
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.update
import kotlin.time.Instant
import kotlin.uuid.Uuid

// A one-off is one evening, so its people belong to that week and to no other. Where they are
// written, and how they are read back. Held apart from PartyWrites.kt because a night is the one
// config whose roster is not the config's, and every rule that makes it so lives here.
//
// Inside a transaction, like the rest. See V32__party_one_off.sql and V71.

/**
 * Writes a one-off's names onto the night, and takes them off the roster it keeps.
 *
 * A one-off is one evening, so the people in it ran that week and no other. Written as standing
 * seats they are also the answer for every week that names nobody (see rostersFor), which is every
 * week after the night: a boss run alone a fortnight later divided with a guest who was not there,
 * and paid them. The roster route already goes the long way round this, and says so. See
 * openSoloParty.
 *
 * After writeMembers, not instead of it: that is where a seat gets its share, its sprite and the
 * pins that hold the weeks already played. This moves where the seat APPLIES, nothing else.
 *
 * Your own seat stays standing. It is what the config is, and a pool whose later weeks name nobody
 * has no seat for a drop to be sold by.
 */
internal fun writeNightRoster(
    partyId: Uuid,
    characterId: Uuid,
    members: List<String>,
    now: Instant,
    context: SeatContext,
) {
    saveWeekRoster(partyId, characterId, weekOf(todayIn(now)), members, context)
    PartyMember.update({ PartyMember.partyId eq partyId }) { it[standing] = false }
    PartyMember.update({ (PartyMember.partyId eq partyId) and (PartyMember.characterId eq characterId) }) {
        it[standing] = true
    }
}

/**
 * The names of the seats this config ran a week with, your own character's among them.
 *
 * Through rosterFor, so it is the one answer to "who was in this party", the same one the payouts
 * and Party View read. A week nobody spelled out falls back to the usual roster, so this and
 * standingRosterOf agree on an ordinary party. They part on a one-off, whose guests are written onto
 * the night and stand nowhere else. See writeNightRoster.
 */
internal fun rosterNamesFor(
    partyId: Uuid,
    week: LocalDate,
): List<String> {
    val ran = rosterFor(partyId, week)
    if (ran.isEmpty()) return emptyList()
    // Named in the roster's own order, which is seat position: the list is read back as a party, and
    // one that reorders itself between two calls is one nobody can compare.
    val named =
        PartyMember
            .selectAll()
            .where { PartyMember.id inList ran }
            .associate { it[PartyMember.id] to it[PartyMember.name] }
    return ran.mapNotNull { named[it] }
}

/**
 * The seats a config is holding the boss's clear for.
 *
 * Its usual roster, which is what a config keeps. A ONE-OFF keeps none: it is one night, and its
 * people are written onto that week (see writeNightRoster), so reading its standing seats would find
 * only your own character and let a guest be booked onto two nights of the same boss in one week.
 *
 * A one-off that reaches here is armed for the period being asked about, spent ones having been
 * filtered out above, so the night to read is the one the app is in.
 */
internal fun claimedSeats(
    partyId: Uuid,
    oneOff: Boolean,
    now: Instant,
): List<String> =
    if (oneOff) {
        rosterNamesFor(partyId, weekOf(todayIn(now)))
    } else {
        standingRosterOf(partyId)
    }

/**
 * Why this week's roster cannot go back to the usual party, or null.
 *
 * A one-off has no usual party. It is one night, and its people are written onto that week and
 * nowhere else (see writeNightRoster), so clearing the week does not reveal a roster underneath, it
 * leaves the config naming nobody: a run alone, on the page that lists parties.
 *
 * Only about clearing. Who ran a one-off's night is still the night's to say, and saying it is what
 * the same route is for.
 */
internal fun validateRosterClear(
    partyId: Uuid,
    members: List<String>?,
): String? =
    if (members == null && isOneOff(partyId)) {
        "a one-off is one night, so it has no usual party to go back to"
    } else {
        null
    }
