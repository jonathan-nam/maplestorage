package com.maplestorage.backend.parties

import com.maplestorage.backend.db.Characters
import com.maplestorage.backend.db.Party
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
import org.jetbrains.exposed.v1.core.and
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
    get("/{id}") { getParty() }
    put("/{id}") { savePartyRoute(nexonLookupService) }
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
                val problem = validateMembers(request.members)
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
 * Why this config cannot be created, or null.
 *
 * Refuses rather than repairs: a second config for the same character and boss, a boss the catalog
 * does not have, or somebody else's character would each save something the user did not ask for.
 * Must run inside a transaction.
 */
internal fun validateNewParty(
    request: SavePartyRequest,
    userId: String,
    characterId: Uuid?,
    bossCatalogId: Uuid?,
): String? {
    val owned =
        characterId != null &&
            Characters
                .selectAll()
                .where { (Characters.id eq characterId) and (Characters.userId eq userId) }
                .empty()
                .not()
    val taken =
        characterId != null &&
            bossCatalogId != null &&
            Party
                .selectAll()
                .where { (Party.characterId eq characterId) and (Party.bossCatalogId eq bossCatalogId) }
                .empty()
                .not()

    return when {
        !owned -> "characterId must be one of your characters"
        bossCatalogId == null -> "unknown bossKey"
        taken -> "that character already has a party for this boss"
        else -> validateMembers(request.members)
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
