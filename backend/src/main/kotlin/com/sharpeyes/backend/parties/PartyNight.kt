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
 * Why these standing share counts cannot be written, or null.
 *
 * A name the party does not have is refused rather than ignored: silently dropping it would leave
 * the party believing a seat takes double when nothing recorded it.
 */
internal fun validateShares(
    shares: Map<String, Int>,
    ownCharacterId: Uuid?,
    members: List<String>,
): String? {
    if (shares.isEmpty()) return null
    val named =
        (listOfNotNull(ownCharacterId?.let(::ownSeatName)) + members)
            .map { it.trim().lowercase() }
            .toSet()
    // Matched the way writeMembers matches them, or a name that differs only in case would be
    // counted as the one share it defaults to rather than the zero that was sent.
    val byName = shares.mapKeys { (name, _) -> name.trim().lowercase() }
    return when {
        byName.keys.any { it !in named } -> "shares may only name somebody in this party"
        // Zero is a seat that takes nothing, which some parties agree: one member keeps the drop
        // and owes the others nothing, because they are there for something else. See V44.
        byName.values.any { it < 0 || it > MAX_SHARES } -> "a share count must be between 0 and $MAX_SHARES"
        // Everybody on zero is not an arrangement. It divides the pot by nothing, and the roster
        // sent is the whole party, so no absent name is going to make up the difference.
        named.sumOf { byName[it] ?: 1 } < 1 -> "somebody in the party has to take a share"
        else -> null
    }
}

/** The rules a config's roster has to keep, wherever it is being written. */
internal fun validateMembers(members: List<String>): String? {
    val names = members.map { it.trim() }
    return when {
        // Your own character is the config; the members are the others. Nobody else means a solo
        // run, and a solo run is not a party.
        names.isEmpty() -> "a party needs somebody else in it"
        names.size > MAX_PARTY_SIZE - 1 -> "a party holds at most $MAX_PARTY_SIZE including your character"
        names.any { it.isBlank() } -> "a member needs a character name"
        names.map { it.lowercase() }.distinct().size != names.size -> "the same character twice"
        else -> null
    }
}
