package com.maplestorage.backend.parties

import com.maplestorage.backend.db.BossCatalog
import com.maplestorage.backend.plugins.parseUuidParam
import com.maplestorage.backend.plugins.principalIdAndEmail
import com.maplestorage.backend.services.NexonLookupService
import com.maplestorage.backend.users.ensureUser
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.call
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.RoutingContext
import io.ktor.server.routing.delete
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.put
import io.ktor.server.routing.route
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import kotlin.time.Clock
import kotlin.time.Duration.Companion.days
import kotlin.uuid.Uuid

// A config is one of your characters, on one boss, with the people that character runs it with.
// The character and the boss are what it IS, so they are set once, at create.

fun Route.partyRoutes(nexonLookupService: NexonLookupService) {
    get { listParties() }
    post { createPartyRoute(nexonLookupService) }
    // Before /{id}, and matched ahead of it whatever the order: Ktor scores a constant segment
    // above a parameter. Every pool at once, for the wallet, and the wallet's one settle back.
    get("/loot") { listAllLoot() }
    post("/loot/settle") { settleRoute() }
    get("/{id}") { getParty() }
    put("/{id}") { savePartyRoute(nexonLookupService) }
    put("/{id}/clear") { setClearRoute() }
    delete("/{id}") { deletePartyRoute() }
    route("/{id}/loot") { lootRoutes() }
}

// A lookup is worth retrying after this long. A name that resolved to nothing is usually a typo or
// a character too new to rank, and neither is worth an outbound call on every save.
private val SPRITE_RETRY_AFTER = 7.days

private suspend fun RoutingContext.listParties() {
    val (userId, email) = call.principalIdAndEmail()
    val parties =
        transaction {
            ensureUser(userId, email)
            partiesFor(userId)
        }
    call.respond(parties)
}

/**
 * Every party's pool, in one request.
 *
 * The wallet nets what you owe against what you are owed, so it needs all of them at once, and one
 * request per party would be one per boss per character. No money is computed here: the split has
 * one implementation (frontend/lib/drop-split.ts) and this ships the drops it reads.
 */
private suspend fun RoutingContext.listAllLoot() {
    val (userId, email) = call.principalIdAndEmail()
    val pools =
        transaction {
            ensureUser(userId, email)
            allLootFor(userId)
        }
    call.respond(pools)
}

private suspend fun RoutingContext.getParty() {
    val (userId, email) = call.principalIdAndEmail()
    val partyId = call.parseUuidParam("id") ?: return
    val party =
        transaction {
            ensureUser(userId, email)
            findParty(partyId, userId)
        }
    if (party == null) call.respond(HttpStatusCode.NotFound) else call.respond(party)
}

private suspend fun RoutingContext.createPartyRoute(nexonLookupService: NexonLookupService) {
    val (userId, email) = call.principalIdAndEmail()
    val request = call.receive<SavePartyRequest>()
    val sprites = lookUpSprites(userId, request, email, nexonLookupService)

    val outcome =
        transaction {
            val characterId = Uuid.parseOrNull(request.characterId)
            val bossId = bossIdForKey(request.bossKey)
            val problem = validateNewParty(request, userId, characterId, bossId)
            if (problem != null) {
                problem
            } else {
                val id = createParty(userId, characterId!!, bossId!!, request, Clock.System.now(), sprites)
                findParty(id, userId)!!
            }
        }
    respondToSave(outcome, HttpStatusCode.Created)
}

private suspend fun RoutingContext.savePartyRoute(nexonLookupService: NexonLookupService) {
    val (userId, email) = call.principalIdAndEmail()
    val partyId = call.parseUuidParam("id") ?: return
    val request = call.receive<SavePartyRequest>()
    val sprites = lookUpSprites(userId, request, email, nexonLookupService)

    val outcome =
        transaction {
            if (!ownsParty(partyId, userId)) {
                null
            } else {
                // Against the config's OWN boss, not the request's: the boss is not editable, so a
                // payload naming another one must not widen what difficulties are allowed.
                val bossId = bossIdOfParty(partyId)
                val problem =
                    bossId?.let { validateDifficulty(it, request.difficulty) }
                        ?: validateMembers(request.members)
                if (problem != null) {
                    problem
                } else {
                    saveParty(userId, partyId, request, Clock.System.now(), sprites)
                    findParty(partyId, userId)!!
                }
            }
        }
    respondToSave(outcome, HttpStatusCode.OK)
}

/**
 * Ticks this config's boss cleared for the current period, or un-ticks it.
 *
 * The same row the clear matrix reads, so the two pages cannot disagree, and the same row the next
 * planner capture will overwrite.
 */
private suspend fun RoutingContext.setClearRoute() {
    val (userId, email) = call.principalIdAndEmail()
    val partyId = call.parseUuidParam("id") ?: return
    val request = call.receive<SetClearRequest>()

    val party =
        transaction {
            ensureUser(userId, email)
            val found = findParty(partyId, userId)
            if (found != null) {
                val boss =
                    BossCatalog
                        .selectAll()
                        .where { BossCatalog.bossKey eq found.bossKey }
                        .first()
                setPartyClear(found, boss[BossCatalog.id], boss[BossCatalog.reset], request.cleared, Clock.System.now())
            }
            if (found == null) null else findParty(partyId, userId)
        }
    if (party == null) call.respond(HttpStatusCode.NotFound) else call.respond(party)
}

private suspend fun RoutingContext.deletePartyRoute() {
    val (userId, email) = call.principalIdAndEmail()
    val partyId = call.parseUuidParam("id") ?: return

    val outcome =
        transaction {
            ensureUser(userId, email)
            when {
                !ownsParty(partyId, userId) -> null
                // Deleting the config would take its pool with it, and a paid-out split is a
                // record rather than a setting.
                lootCountsFor(listOf(partyId)).isNotEmpty() ->
                    "this party has loot in its pool, clear the pool first"
                else -> {
                    deleteParty(partyId, userId)
                    HttpStatusCode.NoContent
                }
            }
        }
    when (outcome) {
        null -> call.respond(HttpStatusCode.NotFound)
        is String -> call.respond(HttpStatusCode.BadRequest, outcome)
        else -> call.respond(HttpStatusCode.NoContent)
    }
}

private suspend fun RoutingContext.respondToSave(
    outcome: Any?,
    onSuccess: HttpStatusCode,
) {
    when (outcome) {
        null -> call.respond(HttpStatusCode.NotFound)
        is String -> call.respond(HttpStatusCode.BadRequest, outcome)
        is PartyResponse -> call.respond(onSuccess, outcome)
        else -> call.respond(HttpStatusCode.InternalServerError)
    }
}

/**
 * Sprites for the members that need one, looked up by character name.
 *
 * A member who is one of your own characters is skipped: those read the character's own sprite.
 * A name already carrying a sprite is left alone, and one whose lookup came back empty recently is
 * not asked again. Never throws.
 */
private suspend fun RoutingContext.lookUpSprites(
    userId: String,
    request: SavePartyRequest,
    email: String,
    nexonLookupService: NexonLookupService,
): Map<String, String?> {
    val known =
        transaction {
            ensureUser(userId, email)
            seatSpritesByCharacter(userId)
        }
    val now = Clock.System.now()
    val wanted =
        request.members
            .map { it.trim() }
            .filter { it.isNotEmpty() }
            .distinct()
            .filter { name ->
                val seat = known[name]
                val stale = seat?.refreshedAt?.let { now - it > SPRITE_RETRY_AFTER } ?: true
                seat?.spriteImgUrl == null && stale
            }
    if (wanted.isEmpty()) return emptyMap()

    // Outside the transaction above: an outbound HTTP call per name, and holding a connection
    // across it would tie up the pool for as long as Nexon takes to answer.
    return coroutineScope {
        wanted
            .map { name -> async { name to nexonLookupService.lookup(name)?.spriteImgUrl } }
            .awaitAll()
            .toMap()
    }
}
