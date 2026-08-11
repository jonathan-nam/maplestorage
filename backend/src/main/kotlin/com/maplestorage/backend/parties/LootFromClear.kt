package com.maplestorage.backend.parties

import com.maplestorage.backend.bosses.periodAfter
import com.maplestorage.backend.bosses.periodOf
import com.maplestorage.backend.db.BossDropAmount
import com.maplestorage.backend.db.DropCatalog
import com.maplestorage.backend.db.Party
import com.maplestorage.backend.db.PartyLoot
import com.maplestorage.backend.db.PartyLootBundle
import com.maplestorage.backend.db.VestigeSettlementLoot
import kotlinx.datetime.LocalDate
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.greaterEq
import org.jetbrains.exposed.v1.core.inList
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
 * Solo pools file too. One seat means the whole drop is yours, which is the same row a party gets
 * and a share of one nobody has to work out.
 *
 * Silent about everything it cannot be sure of, and each of these is a reason a pool sees nothing
 * appear rather than a wrong row:
 *
 *  - no config for the pair, so there is no pool to file into
 *  - a RETIRED config, whose pool is history rather than a party still running
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
    val partyId = partyIdFor(characterId, bossCatalogId)
    val config =
        partyId?.let {
            Party
                .selectAll()
                .where { Party.id eq it }
                .firstOrNull()
        }
    val difficulty = config?.get(Party.difficulty)
    // Deleting a config that has drops retires it and keeps the pool, so the history survives (see
    // retireOrDeleteParty). History is not a party still running, and filing into one put 120
    // coupons in a deleted party's pool nine days after it went, split with a guest who was not
    // there. Nothing says where it came from either: the config is off Party View by then.
    val standing = config?.get(Party.standing) == true
    if (partyId == null || difficulty == null || !standing) return

    val period = periodOf(reset, on)
    val nextPeriod = periodAfter(reset, period)
    // Dated inside the period the CLEAR is for, so a clear ticked for a past week files in that week
    // rather than this one. Today when the period is the one today falls in, which is the ordinary
    // case and the date a human would have typed.
    val droppedOn = if (on >= period && on < nextPeriod) on else period
    // WHAT FELL, always, never a share of it. A share depends on who ran and whether one of them
    // loots, both of which are edited long after the clear was ticked, and a stored share does not
    // follow: one Limbo row read 60 for months after its party became an even three-way split. The
    // share is worked out on every read now, from the party as it stands. See V40.
    guaranteedDrops(bossCatalogId, difficulty)
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
 *
 * A retired config is NOT skipped here, unlike lootFromClear: rows filed into one before that rule
 * existed still have to be removable by the tick that put them there.
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
    val filed =
        PartyLoot
            .selectAll()
            .where {
                (PartyLoot.partyId eq partyId) and
                    (PartyLoot.fromClear eq true) and
                    (PartyLoot.soldAt eq null) and
                    (PartyLoot.droppedOn greaterEq period) and
                    (PartyLoot.droppedOn less nextPeriod)
            }.map { it[PartyLoot.id] }
    val spoken = spokenFor(filed)
    val loose = filed.filterNot { it in spoken }
    if (loose.isEmpty()) return
    PartyLoot.deleteWhere { PartyLoot.id inList loose }
}

/**
 * The rows something else has already said something about.
 *
 * `sold_at` alone is not enough to call a row untouched. A drop that comes in pieces never gets one:
 * it settles through the tranche ledger, so its sold_at stays null for ever (see LootPoolWork.kt),
 * and coupons are the only thing a clear files. Without this, closing a holder's books and then
 * correcting the mode you ran would take the closure with the row, silently.
 *
 * Two claims, both a human's: the books closed over this drop, and which seat picked up which stack.
 */
private fun spokenFor(lootIds: List<Uuid>): Set<Uuid> {
    if (lootIds.isEmpty()) return emptySet()
    val settled =
        VestigeSettlementLoot
            .selectAll()
            .where { VestigeSettlementLoot.lootId inList lootIds }
            .map { it[VestigeSettlementLoot.lootId] }
    val bundled =
        PartyLootBundle
            .selectAll()
            .where { PartyLootBundle.lootId inList lootIds }
            .map { it[PartyLootBundle.lootId] }
    return (settled + bundled).toSet()
}

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
