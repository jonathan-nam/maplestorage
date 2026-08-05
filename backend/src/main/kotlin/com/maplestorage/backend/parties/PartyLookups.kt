package com.maplestorage.backend.parties

import com.maplestorage.backend.db.BossCatalog
import com.maplestorage.backend.db.Characters
import com.maplestorage.backend.db.DropCatalog
import com.maplestorage.backend.db.Party
import com.maplestorage.backend.db.PartyMember
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.jdbc.selectAll
import kotlin.time.Instant
import kotlin.uuid.Uuid

// The reads a grid save needs before it is allowed: which seats a party has, whether every
// submitted boss key is real, and what sprites have already been found. Inside a transaction,
// like the rest.

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

/** The boss a config is for, or null when there is no such config. */
internal fun bossIdOfParty(partyId: Uuid): Uuid? =
    Party
        .selectAll()
        .where { Party.id eq partyId }
        .firstOrNull()
        ?.get(Party.bossCatalogId)

/** True when this character is one of the user's. The check every write on a character starts with. */
internal fun ownsCharacter(
    characterId: Uuid,
    userId: String,
): Boolean =
    Characters
        .selectAll()
        .where { (Characters.id eq characterId) and (Characters.userId eq userId) }
        .empty()
        .not()

/** The character a config belongs to, or null when there is no such config. */
internal fun characterIdOfParty(partyId: Uuid): Uuid? =
    Party
        .selectAll()
        .where { Party.id eq partyId }
        .firstOrNull()
        ?.get(Party.characterId)

/** A boss's reset cadence, which is what filing a clear against a date needs. See BossPeriod.kt. */
internal fun bossResetOf(bossCatalogId: Uuid): String? =
    BossCatalog
        .selectAll()
        .where { BossCatalog.id eq bossCatalogId }
        .firstOrNull()
        ?.get(BossCatalog.reset)

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

/**
 * Every sprite this account has already looked up, keyed by CHARACTER name.
 *
 * Across all parties, not one: the same character shows up in several rows of the grid, and asking
 * Nexon again for a name we already have an answer for is a round trip per row.
 */
internal fun seatSpritesByCharacter(userId: String): Map<String, SeatSprite> =
    PartyMember
        .innerJoin(Party)
        .selectAll()
        .where { Party.userId eq userId }
        .groupBy { it[PartyMember.name] }
        .mapValues { (_, rows) ->
            // The best answer this account has for that character, not the last row that mentioned
            // them: a seat created after the lookup ran carries a null of its own, and picking that
            // one would lose a sprite it already has and ask Nexon for it again.
            SeatSprite(
                spriteImgUrl = rows.firstNotNullOfOrNull { it[PartyMember.spriteImgUrl] },
                refreshedAt = rows.mapNotNull { it[PartyMember.spriteRefreshedAt] }.maxOrNull(),
            )
        }
