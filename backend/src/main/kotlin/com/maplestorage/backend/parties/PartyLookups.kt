package com.maplestorage.backend.parties

import com.maplestorage.backend.db.BossCatalog
import com.maplestorage.backend.db.Characters
import com.maplestorage.backend.db.DropCatalog
import com.maplestorage.backend.db.PartyMember
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.jdbc.selectAll
import kotlin.time.Instant
import kotlin.uuid.Uuid

// The reads validateParty needs before a write is allowed: whose characters these are, which
// seats this party actually has, and whether every submitted boss key is a real one. Inside a
// transaction, like the rest.

/** The caller's character ids, so a seat cannot be linked to somebody else's character. */
internal fun ownedCharacterIds(userId: String): Set<Uuid> =
    Characters
        .selectAll()
        .where { Characters.userId eq userId }
        .map { it[Characters.id] }
        .toSet()

/** The seat ids currently in this party, so an edit cannot reach a seat in another one. */
internal fun memberIdsOf(partyId: Uuid): Set<Uuid> =
    PartyMember
        .selectAll()
        .where { PartyMember.partyId eq partyId }
        .map { it[PartyMember.id] }
        .toSet()

/**
 * Catalog ids for the submitted keys, or null if any key is not a tracked boss.
 *
 * Null rather than a silent skip: an unknown key means the client and catalog/bosses.yaml have
 * drifted, and a party that quietly covers two of the three bosses you asked for is the kind of
 * wrong-and-plausible this repo exists to avoid. Untracked bosses are seeded into no table, so
 * "Zakum" lands here too and is refused for the same reason.
 */
internal fun bossIdsForKeys(keys: List<String>): Map<String, Uuid>? {
    val wanted = keys.distinct()
    if (wanted.isEmpty()) return emptyMap()
    val found =
        BossCatalog
            .selectAll()
            .where { BossCatalog.bossKey inList wanted }
            .associate { it[BossCatalog.bossKey] to it[BossCatalog.id] }
    return if (found.size == wanted.size) found else null
}

/** The catalog id for a drop key, or null when there is no such drop. */
internal fun dropIdForKey(dropKey: String): Uuid? =
    DropCatalog
        .selectAll()
        .where { DropCatalog.dropKey eq dropKey }
        .firstOrNull()
        ?.get(DropCatalog.id)

/** The catalog id for a boss key, or null when it is not a tracked boss. */
internal fun bossIdForKey(bossKey: String): Uuid? =
    BossCatalog
        .selectAll()
        .where { BossCatalog.bossKey eq bossKey }
        .firstOrNull()
        ?.get(BossCatalog.id)

/** A seat's stored sprite and when the lookup that filled it last ran, keyed by the seat's name. */
internal data class SeatSprite(
    val spriteImgUrl: String?,
    val refreshedAt: Instant?,
)

internal fun seatSpritesOf(partyId: Uuid): Map<String, SeatSprite> =
    PartyMember
        .selectAll()
        .where { PartyMember.partyId eq partyId }
        .associate {
            it[PartyMember.name] to
                SeatSprite(it[PartyMember.spriteImgUrl], it[PartyMember.spriteRefreshedAt])
        }
