package com.maplestorage.backend.parties

import com.maplestorage.backend.bosses.periodOf
import com.maplestorage.backend.bosses.periodStartFor
import com.maplestorage.backend.db.BossClear
import com.maplestorage.backend.db.Party
import kotlinx.datetime.LocalDate
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.upsert
import kotlin.time.Instant
import kotlin.uuid.Uuid

// What a config says about its boss being dead. Three writes onto boss_clear, which is the same row
// the clear matrix draws and a planner capture overwrites: one answer to "is Kalos done this week",
// reached from a party row, from a drop, or by taking the config away.
//
// None of them touches the pool. A tick used to file the drops the catalog guarantees at the config's
// mode, so ticking Extreme Kalos put 180 coupons there by itself; nobody reading the pool could tell
// where they had come from, and correcting the tick moved money. What fell is typed now, with the
// count the config already knows filled in (see defaultQuantity in the frontend).
//
// Inside a transaction, like the rest.

/**
 * Marks this config's boss cleared, or not, for the period it is currently in.
 *
 * Ticking it here is another way of saying what a planner capture says, rather than a second place to
 * keep it.
 *
 * source_screenshot_id is left null on purpose. It is what tells a hand-tick from a capture later,
 * and the next capture will replace this row with one that has a screenshot behind it.
 */
internal fun setPartyClear(
    party: PartyResponse,
    bossCatalogId: Uuid,
    reset: String,
    cleared: Boolean,
    now: Instant,
) {
    BossClear.upsert(BossClear.characterId, BossClear.bossCatalogId, BossClear.periodStart) { row ->
        row[characterId] = Uuid.parse(party.characterId)
        row[BossClear.bossCatalogId] = bossCatalogId
        row[periodStart] = periodStartFor(reset, now)
        row[BossClear.cleared] = cleared
        row[capturedAt] = now
        row[sourceScreenshotId] = null
    }
}

/**
 * The clear a drop implies: something fell, so the boss died.
 *
 * Only ever writes true, and only over silence or a "not cleared". A clear already recorded is
 * left alone rather than rewritten, which is what keeps the screenshot behind a captured one and
 * stops it being relabelled as a hand tick.
 *
 * The period is the DROP'S, not today's. A drop carries the date it fell on, so filing the clear
 * against the day the request arrived would tick this week for a kill in the last one. That also
 * makes this the one clear a past period can gain: unlike a tick, a drop says which period it
 * belongs to.
 *
 * Nothing here goes the other way. Deleting the drop does not un-clear the boss, since removing
 * the record of what fell says nothing about whether it died.
 */
internal fun clearFromDrop(
    characterId: Uuid,
    bossCatalogId: Uuid,
    reset: String,
    droppedOn: LocalDate,
    now: Instant,
) {
    val period = periodOf(reset, droppedOn)
    val already =
        BossClear
            .selectAll()
            .where {
                (BossClear.characterId eq characterId) and
                    (BossClear.bossCatalogId eq bossCatalogId) and
                    (BossClear.periodStart eq period)
            }.firstOrNull()
            ?.get(BossClear.cleared) == true
    if (already) return

    BossClear.upsert(BossClear.characterId, BossClear.bossCatalogId, BossClear.periodStart) { row ->
        row[BossClear.characterId] = characterId
        row[BossClear.bossCatalogId] = bossCatalogId
        row[periodStart] = period
        row[cleared] = true
        row[capturedAt] = now
        row[sourceScreenshotId] = null
    }
}

/**
 * Takes back the clear this config's boss is ticked for in the period it is in now.
 *
 * A tick made through a party row is that party saying it ran the boss, so taking the config off
 * Party View takes the statement with it. Without this, deleting a config and adding it again handed
 * back a boss already ticked, which nobody had entered.
 *
 * The ROW is deleted rather than set false. False is somebody saying the boss is NOT done, which is
 * a claim of its own that the clear matrix draws; nobody is making it. Nobody has said anything.
 *
 * A hand tick only. A clear with a screenshot behind it is what a capture read off the planner, and
 * deleting a config does not unmake a capture or make its evidence wrong.
 *
 * This period only. Earlier ones are history, which the matrix draws and a retired pool keeps, and a
 * boss killed in July was still killed in July.
 */
internal fun withdrawClear(
    partyId: Uuid,
    now: Instant,
) {
    val config = Party.selectAll().where { Party.id eq partyId }.firstOrNull()
    val bossId = config?.get(Party.bossCatalogId)
    val characterId = config?.get(Party.characterId)
    val reset = bossId?.let(::bossResetOf)
    if (bossId == null || characterId == null || reset == null) return
    val period = periodStartFor(reset, now)
    val ticked =
        BossClear
            .selectAll()
            .where {
                (BossClear.characterId eq characterId) and
                    (BossClear.bossCatalogId eq bossId) and
                    (BossClear.periodStart eq period)
            }.firstOrNull()
    if (ticked == null || ticked[BossClear.sourceScreenshotId] != null) return

    BossClear.deleteWhere {
        (BossClear.characterId eq characterId) and
            (BossClear.bossCatalogId eq bossId) and
            (BossClear.periodStart eq period)
    }
}
