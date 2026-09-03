package com.sharpeyes.backend.parties

import com.sharpeyes.backend.bosses.weekOf
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyMember
import kotlinx.datetime.LocalDate
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.jdbc.selectAll
import kotlin.uuid.Uuid

// Who a DROP divides between, which is not always who ran that week. Kept apart from PartyRoster.kt
// for that reason: the week's roster is a fact about the party, and this is a fact about the row.
// Inside a transaction, like the rest.

/**
 * The seats a drop divides between: the roster of the week it fell in, or your own seat alone.
 *
 * A drop logged from the Drop Log names no party and claims none, so it is a run with nobody else
 * however the pool reads that week. Said by the DROP rather than by the config, for V69's reason: a
 * config is one mutable row describing an arrangement, and a night is a fact. See logDropRoute.
 *
 * A pool with no seat for its own character answers with nothing, which refuses the sale rather than
 * dividing it by a roster the drop has just said was not there.
 */
internal fun ranWith(
    partyId: Uuid,
    droppedOn: LocalDate,
    solo: Boolean,
): List<Uuid> = if (solo) ownSeatsOf(listOf(partyId))[partyId].orEmpty() else rosterFor(partyId, weekOf(droppedOn))

/**
 * Each party's own character's seat, keyed by party. The roster of a drop that fell on a solo run.
 *
 * Batched for the same reason rostersFor is: a pool is read a page at a time.
 */
internal fun ownSeatsOf(partyIds: List<Uuid>): Map<Uuid, List<Uuid>> {
    if (partyIds.isEmpty()) return emptyMap()
    return PartyMember
        .innerJoin(Party)
        .selectAll()
        .where { (PartyMember.partyId inList partyIds) and (PartyMember.characterId eq Party.characterId) }
        .groupBy({ it[PartyMember.partyId] }) { it[PartyMember.id] }
}
