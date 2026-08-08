package com.maplestorage.backend.parties

import com.maplestorage.backend.bosses.periodAfter
import com.maplestorage.backend.bosses.periodOf
import com.maplestorage.backend.bosses.weekOf
import com.maplestorage.backend.db.BossDropAmount
import com.maplestorage.backend.db.DropCatalog
import com.maplestorage.backend.db.Party
import com.maplestorage.backend.db.PartyLoot
import kotlinx.datetime.LocalDate
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.greaterEq
import org.jetbrains.exposed.v1.core.less
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.selectAll
import kotlin.time.Instant
import kotlin.uuid.Uuid

// The drops a clear implies, and taking them back when the clear goes away.
//
// The inverse of clearFromDrop, which has read the pair the other way round since V18: something
// fell, so the boss died. This is the other end. Some drops are GUARANTEED and their amount is in
// the catalog, so clearing Extreme Kalos already says 180 vestige coupons landed and typing that in
// is busywork. See V37__loot_from_clear.sql.
//
// Only drops the catalog has an amount for. That is what makes this a fact rather than a guess: a
// drop with no amount for this boss and difficulty may or may not have fallen, and the pool would be
// claiming something nobody saw.
//
// Inside a transaction, like the rest.

/**
 * Files what this clear guarantees, if anything.
 *
 * Silent about everything it cannot be sure of, and each of these is a reason a party sees nothing
 * appear rather than a wrong row:
 *
 *  - no config for the pair, so there is no pool to file into
 *  - a solo config, where one seat means nothing to divide and nothing to owe
 *  - no difficulty recorded, so which amount applies is unknown
 *  - no amount for that boss and difficulty, which is most of them
 *  - a row already there for this period, so re-ticking a clear does not stack up three of them
 */
internal fun lootFromClear(
    characterId: Uuid,
    bossCatalogId: Uuid,
    reset: String,
    on: LocalDate,
    now: Instant,
) {
    // One expression rather than a chain of early returns: each of these is the same answer, that
    // there is nothing this clear can be sure of.
    val partyId = partyIdFor(characterId, bossCatalogId)?.takeUnless { isSoloParty(it) }
    val difficulty =
        partyId?.let {
            Party
                .selectAll()
                .where { Party.id eq it }
                .firstOrNull()
                ?.get(Party.difficulty)
        }
    if (partyId == null || difficulty == null) return

    val period = periodOf(reset, on)
    val nextPeriod = periodAfter(reset, period)
    // How much of the drop this row is FOR. A party where one member loots the lot holds the whole
    // thing in one inventory and owes the others their share, so the row is the whole thing. A party
    // where everybody loots their own never pooled it: there is nothing to divide and nothing owed,
    // and the only pieces this character has are their own share.
    val looted = looterOf(partyId)
    val ran = rosterFor(partyId, weekOf(period)).size
    // Dated inside the period the CLEAR is for, so a clear ticked for a past week files in that week
    // rather than this one. Today when the period is the one today falls in, which is the ordinary
    // case and the date a human would have typed.
    val droppedOn = if (on >= period && on < nextPeriod) on else period
    guaranteedDrops(bossCatalogId, difficulty)
        .map { (dropId, wholeDrop) -> dropId to shareOf(wholeDrop, looted != null, ran) }
        .filter { (dropId, pieces) -> pieces >= 1 && !alreadyFiled(partyId, dropId, period, nextPeriod) }
        .forEach { (dropId, pieces) ->
            addLoot(
                partyId,
                LootedDrop(dropId, quantity = pieces),
                bossCatalogId,
                droppedOn,
                now,
                fromClear = true,
            )
        }
}

/**
 * How many of a drop this row is for.
 *
 * The whole thing where one member loots the lot: it is all in one inventory and they owe the others
 * their share. A share of it where everybody loots their own, because it was never pooled and the
 * only pieces this character has are their own.
 *
 * Rounded down. An amount that will not divide means somebody took the odd pieces by agreement,
 * which is the uneven night the ledger is for rather than something a clear can state on its own.
 */
private fun shareOf(
    wholeDrop: Int,
    oneMemberLoots: Boolean,
    ran: Int,
): Int = if (oneMemberLoots || ran < 1) wholeDrop else wholeDrop / ran

/** True when this period already has a row for this drop, so re-ticking cannot stack up a second. */
private fun alreadyFiled(
    partyId: Uuid,
    dropId: Uuid,
    period: LocalDate,
    nextPeriod: LocalDate,
): Boolean =
    PartyLoot
        .selectAll()
        .where {
            (PartyLoot.partyId eq partyId) and
                (PartyLoot.dropCatalogId eq dropId) and
                (PartyLoot.droppedOn greaterEq period) and
                (PartyLoot.droppedOn less nextPeriod)
        }.empty()
        .not()

/**
 * Takes back what a clear put there, and nothing else.
 *
 * Only rows the app added itself (from_clear), and only while they are untouched: a row that has
 * been sold is money somebody is owed, and un-ticking a clear is not a statement about that. A row a
 * human logged is left alone whatever the clear says, because they saw it fall.
 */
internal fun unlootFromClear(
    characterId: Uuid,
    bossCatalogId: Uuid,
    reset: String,
    on: LocalDate,
) {
    val partyId = partyIdFor(characterId, bossCatalogId) ?: return
    val period = periodOf(reset, on)
    val nextPeriod = periodAfter(reset, period)
    PartyLoot.deleteWhere {
        (PartyLoot.partyId eq partyId) and
            (PartyLoot.fromClear eq true) and
            (PartyLoot.soldAt eq null) and
            (PartyLoot.droppedOn greaterEq period) and
            (PartyLoot.droppedOn less nextPeriod)
    }
}

/** The seat that loots for this party, or null when everybody loots their own. */
private fun looterOf(partyId: Uuid): Uuid? =
    Party
        .selectAll()
        .where { Party.id eq partyId }
        .firstOrNull()
        ?.get(Party.looterMemberId)

/** What this boss drops for certain at this difficulty, as (drop id -> pieces). */
private fun guaranteedDrops(
    bossCatalogId: Uuid,
    difficulty: String,
): List<Pair<Uuid, Int>> =
    BossDropAmount
        .innerJoin(DropCatalog)
        .selectAll()
        .where {
            (BossDropAmount.bossCatalogId eq bossCatalogId) and (BossDropAmount.difficulty eq difficulty)
        }.map { it[BossDropAmount.dropCatalogId] to it[BossDropAmount.pieces] }
