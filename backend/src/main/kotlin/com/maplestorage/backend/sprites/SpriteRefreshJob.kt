package com.maplestorage.backend.sprites

import com.maplestorage.backend.characters.applyLookup
import com.maplestorage.backend.db.CharacterSprite
import com.maplestorage.backend.db.Characters
import com.maplestorage.backend.db.PartyMember
import com.maplestorage.backend.services.NexonLookupService
import io.ktor.server.application.Application
import io.ktor.server.application.log
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.jetbrains.exposed.v1.core.SortOrder
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.core.less
import org.jetbrains.exposed.v1.core.or
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import org.jetbrains.exposed.v1.jdbc.update
import kotlin.time.Clock
import kotlin.time.Duration.Companion.days
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Duration.Companion.seconds
import kotlin.time.Instant
import kotlin.uuid.Uuid

// A character's appearance is theirs to change whenever they like, and nothing tells us when they
// have. So it is re-asked on a clock, and a day is the resolution: an outfit change showing up
// within a day is not worth a lookup per page view.
private val SPRITE_MAX_AGE = 1.days

// How often to look for characters that have come due. Not the refresh interval: a tick refreshes
// only what is older than SPRITE_MAX_AGE, so a short one costs a cheap indexed query and spreads
// the work of a day's worth of characters instead of doing all of it on the hour.
private val TICK_INTERVAL = 30.minutes

// Ceiling on one tick's outbound calls. Each character costs FOUR requests to Nexon's ranking
// endpoint (the world fan-out) plus one image fetch, against a community-run API this app is a guest
// on. At a tick every 30 minutes this still clears 960 characters a day, far past what the app holds.
private const val BATCH = 20

// Between characters within a tick. The fan-out already makes 4 concurrent calls per character;
// stacking those back to back is what a burst looks like from the far end.
private val PACING = 2.seconds

// An orphan is a cached sprite nothing points at any more: the character it belonged to changed
// outfit, was deleted, or was renamed. Kept for a week rather than deleted at the moment it is
// orphaned, so flipping an outfit back does not re-fetch, and so a bug that drops a reference for a
// day does not also throw away the bytes.
private val ORPHAN_GRACE = 7.days

/**
 * Re-asks Nexon what each character looks like, about once a day per character.
 *
 * Outfits change and Nexon's URL encodes the outfit, so the cached bytes never go stale (a new
 * outfit is a new URL) but the URL on the character does. That is what this refreshes; the byte
 * cache follows from it.
 *
 * Party seats that are not one of this account's characters are deliberately not in scope. Those
 * have their own policy in PartySprites.kt (fill when empty, retry a miss after a week), and putting
 * every seat of every roster on a daily clock would multiply the call volume by roster size.
 */
class SpriteRefreshJob(
    private val nexonLookupService: NexonLookupService,
    private val spriteCache: SpriteCache,
) {
    /** One character due for a re-ask. */
    internal data class Due(
        val id: Uuid,
        val userId: String,
        val name: String,
    )

    /**
     * Refreshes up to [BATCH] characters that have not been asked about within [SPRITE_MAX_AGE].
     *
     * Returns how many were asked about, not how many changed: a character whose outfit is the same
     * still counts, having cost the same lookup.
     */
    suspend fun runOnce(now: Instant = Clock.System.now()): Int {
        val due = transaction { dueCharacters(now) }
        for ((index, character) in due.withIndex()) {
            if (index > 0) delay(PACING)
            refresh(character, Clock.System.now())
        }
        return due.size
    }

    internal suspend fun refresh(
        character: Due,
        now: Instant,
    ) {
        val lookup = nexonLookupService.lookup(character.name)
        // Outside the transaction: two outbound calls, and holding a pooled connection across them
        // ties it up for as long as Nexon takes to answer.
        val bytes = lookup?.spriteImgUrl?.let { spriteCache.fetch(it) }

        transaction {
            // A failed lookup leaves the name, level, job and sprite alone rather than blanking
            // them: it is far likelier that Nexon had a bad minute than that the character stopped
            // existing. `sprite_checked_at` still moves, which is what keeps an unresolvable name
            // out of the next tick's batch.
            if (lookup != null) {
                applyLookup(character.id, character.userId, lookup, now)
                spriteCache.store(lookup.spriteImgUrl, bytes)
            }
            Characters.update({ Characters.id eq character.id }) {
                it[spriteCheckedAt] = now
            }
        }
    }

    /**
     * The characters that have not been asked about within [SPRITE_MAX_AGE], oldest first.
     *
     * [limit] is a parameter rather than always [BATCH] so a test can ask for the whole set: this
     * query is account-wide by design, and a test asserting on a batch of 20 would be asserting
     * about whatever else happens to be in the database.
     *
     * Must be called from inside a `transaction { }` block.
     */
    internal fun dueCharacters(
        now: Instant,
        limit: Int = BATCH,
    ): List<Due> =
        Characters
            .selectAll()
            .where {
                // A character with no sprite at all is included: a lookup that came back empty when
                // they were added is worth re-asking, since a brand-new character ranks eventually.
                (Characters.spriteCheckedAt eq null) or (Characters.spriteCheckedAt less (now - SPRITE_MAX_AGE))
            }.orderBy(Characters.spriteCheckedAt to SortOrder.ASC_NULLS_FIRST)
            .limit(limit)
            .map { Due(it[Characters.id], it[Characters.userId], it[Characters.name]) }
}

/**
 * Deletes cached sprites nothing points at, once they are past [ORPHAN_GRACE].
 *
 * Without this the table gains a row per outfit change per character and never loses one. The
 * reference check is done here rather than in SQL because it needs [spriteKey]: the tables store the
 * URL and this one is keyed by its hash.
 *
 * Must be called from inside a `transaction { }` block.
 */
fun sweepOrphanedSprites(now: Instant): Int {
    val characterUrls = Characters.selectAll().mapNotNull { it[Characters.spriteImgUrl] }
    val seatUrls = PartyMember.selectAll().mapNotNull { it[PartyMember.spriteImgUrl] }
    val referenced = (characterUrls + seatUrls).map { spriteKey(it) }.toSet()

    val cutoff = now - ORPHAN_GRACE
    val orphans =
        CharacterSprite
            .selectAll()
            .where { CharacterSprite.createdAt less cutoff }
            .map { it[CharacterSprite.urlSha256] }
            .filter { it !in referenced }
    if (orphans.isEmpty()) return 0
    return CharacterSprite.deleteWhere { urlSha256 inList orphans }
}

/**
 * Starts the refresh loop for the life of the application.
 *
 * One process refreshes, which is true of this deployment (a single Lightsail instance running
 * docker-compose) and is the only reason no row-level claim is taken. Two instances would each do
 * the work: wasteful against Nexon, but every write here is idempotent, so not wrong.
 */
fun Application.startSpriteRefresh(job: SpriteRefreshJob) {
    launch {
        // Not on boot. A deploy restarts the process, and refreshing on every restart turns a busy
        // afternoon of deploys into a burst of lookups that the clock exists to avoid.
        delay(TICK_INTERVAL)
        while (true) {
            runCatching {
                val asked = job.runOnce()
                val swept = transaction { sweepOrphanedSprites(Clock.System.now()) }
                if (asked > 0 || swept > 0) {
                    log.info("Sprite refresh: asked about $asked character(s), swept $swept cached sprite(s)")
                }
            }.onFailure {
                // The loop outlives one bad tick. A lookup that throws, a database blip: the next
                // tick is 30 minutes away and the batch is picked fresh, so nothing is lost by
                // giving up on this one.
                log.warn("Sprite refresh tick failed", it)
            }
            delay(TICK_INTERVAL)
        }
    }
}
