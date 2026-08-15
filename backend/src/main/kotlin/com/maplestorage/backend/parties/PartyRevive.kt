package com.maplestorage.backend.parties

import com.maplestorage.backend.db.Party
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.jdbc.selectAll
import kotlin.time.Instant
import kotlin.uuid.Uuid

// The one door a config comes back through without being written: a drop. retireOrDeleteParty is
// the way out, and addLoot is the way back in, so the rule the edit page enforces has to be asked
// here too.

/**
 * Whether a retired config may come back off the strength of a drop.
 *
 * True for one that is already standing, which is every ordinary drop: there is nothing to bring
 * back, and the roster was checked when it was written.
 *
 * validateBossRoster is asked at every door a config is EDITED through, but a drop reopens one
 * without going through any of them. A seat that took the boss up elsewhere while this config was
 * retired would otherwise come back double-booked: two standing configs naming one character for a
 * boss they can only clear once a period, which is the single state that rule exists to refuse.
 *
 * Reads the STANDING roster rather than the drop's week. What is being asked is whether this config
 * can be on from now on, and a week that has already passed is not what putting it back on Party
 * View claims.
 *
 * Must run inside a transaction.
 */
internal fun revivesCleanly(
    partyId: Uuid,
    now: Instant,
): Boolean {
    val retired =
        Party
            .selectAll()
            .where { (Party.id eq partyId) and (Party.standing eq false) }
            .firstOrNull() ?: return true

    return validateBossRoster(
        retired[Party.userId],
        retired[Party.bossCatalogId],
        // Not competition with itself: it is the config being brought back.
        exclude = partyId,
        standingRosterOf(partyId),
        now,
    ) == null
}
