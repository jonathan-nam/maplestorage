package com.maplestorage.backend.parties

import com.maplestorage.backend.db.Party
import com.maplestorage.backend.db.Person
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

fun Route.partyRoutes(nexonLookupService: NexonLookupService) {
    get { listParties() }
    // Registered before /{id}, or the parameter route swallows the literal.
    get("/grid") { getGrid() }
    // The only way to write a party. One editing surface, so the roster cannot be edited into two
    // different shapes by two different endpoints.
    put("/grid") { saveGridRoute(nexonLookupService) }
    get("/{id}") { getParty() }
    delete("/{id}") { deletePartyRoute() }
    route("/{id}/loot") { lootRoutes() }
}

// A lookup is worth retrying after this long. A name that resolved to nothing is usually a typo or
// a character too new to rank, and neither is worth an outbound call on every save; a week is long
// enough to be free in practice and short enough that a fixed name comes back on its own.
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

private suspend fun RoutingContext.getGrid() {
    val (userId, email) = call.principalIdAndEmail()
    val grid =
        transaction {
            ensureUser(userId, email)
            gridFor(userId)
        }
    call.respond(grid)
}

/**
 * The whole roster, saved in one request.
 *
 * Validated before anything is written, so a grid that cannot be saved leaves the old one exactly
 * as it was rather than half applied.
 */
private suspend fun RoutingContext.saveGridRoute(nexonLookupService: NexonLookupService) {
    val (userId, email) = call.principalIdAndEmail()
    val request = call.receive<SaveGridRequest>()

    val known =
        transaction {
            ensureUser(userId, email)
            seatSpritesByCharacter(userId)
        }
    // Outside the transaction: an outbound HTTP call per name, and holding a connection across it
    // would tie up the pool for as long as Nexon takes to answer.
    val sprites = lookUpSeatSprites(request, known, nexonLookupService)

    val outcome =
        transaction {
            val ownedPeople =
                Person
                    .selectAll()
                    .where { Person.userId eq userId }
                    .map { it[Person.id] }
                    .toSet()
            val ownedParties =
                Party
                    .selectAll()
                    .where { Party.userId eq userId }
                    .map { it[Party.id] }
                    .toSet()
            val problem = validateGrid(request, userId, ownedPeople, ownedParties)
            problem ?: saveGrid(userId, request, Clock.System.now(), sprites)
        }

    when (outcome) {
        is String -> call.respond(HttpStatusCode.BadRequest, outcome)
        is PartyGridResponse -> call.respond(outcome)
        else -> call.respond(HttpStatusCode.InternalServerError)
    }
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

private suspend fun RoutingContext.deletePartyRoute() {
    val (userId, email) = call.principalIdAndEmail()
    val partyId = call.parseUuidParam("id") ?: return
    val deleted =
        transaction {
            ensureUser(userId, email)
            deleteParty(partyId, userId)
        }
    call.respond(if (deleted) HttpStatusCode.NoContent else HttpStatusCode.NotFound)
}

/**
 * Sprites for the cells that need one, looked up by character name.
 *
 * A cell holding one of your own characters is skipped: those read the character's own sprite,
 * refreshed where it belongs. A character already carrying a sprite is left alone, and one whose
 * lookup came back empty recently is not asked again.
 *
 * Never throws: NexonLookupService swallows its own failures, and a roster must save whether or
 * not a portrait could be found.
 */
private suspend fun lookUpSeatSprites(
    request: SaveGridRequest,
    known: Map<String, SeatSprite>,
    nexonLookupService: NexonLookupService,
): Map<String, String?> {
    val now = Clock.System.now()
    val wanted =
        request.parties
            // By IGN where there is one: a label like "2nd mech" would find nothing, and asking
            // for it every save is a round trip that can never succeed.
            .flatMap { party -> party.seats.map { (it.ign ?: it.characterName).trim() } }
            .filter { it.isNotEmpty() }
            .distinct()
            .filter { name ->
                val seat = known[name]
                val stale = seat?.refreshedAt?.let { now - it > SPRITE_RETRY_AFTER } ?: true
                seat?.spriteImgUrl == null && stale
            }
    if (wanted.isEmpty()) return emptyMap()

    return coroutineScope {
        wanted
            .map { name -> async { name to nexonLookupService.lookup(name)?.spriteImgUrl } }
            .awaitAll()
            .toMap()
    }
}
