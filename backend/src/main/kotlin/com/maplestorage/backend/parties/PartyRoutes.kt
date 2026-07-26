package com.maplestorage.backend.parties

import com.maplestorage.backend.plugins.parseUuidParam
import com.maplestorage.backend.plugins.principalIdAndEmail
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
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import kotlin.time.Clock
import kotlin.uuid.Uuid

fun Route.partyRoutes() {
    get { listParties() }
    post { createPartyRoute() }
    get("/{id}") { getParty() }
    put("/{id}") { savePartyRoute() }
    delete("/{id}") { deletePartyRoute() }
    route("/{id}/loot") { lootRoutes() }
}

/** What a create or a save can come to. Kept explicit so each maps to one status code, once. */
private sealed interface SaveOutcome {
    data class Invalid(
        val reason: String,
    ) : SaveOutcome

    data object Missing : SaveOutcome

    data class Saved(
        val party: PartyResponse,
    ) : SaveOutcome
}

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

private suspend fun RoutingContext.createPartyRoute() {
    val (userId, email) = call.principalIdAndEmail()
    val request = call.receive<SavePartyRequest>()

    val outcome =
        transaction {
            ensureUser(userId, email)
            // No party yet, so no seat may carry an id: an id here would name a seat in somebody
            // else's party.
            val problem = validateParty(request, ownedCharacterIds(userId), emptySet())
            if (problem != null) {
                SaveOutcome.Invalid(problem)
            } else {
                SaveOutcome.Saved(createParty(userId, request, Clock.System.now()))
            }
        }
    respondToSave(outcome, HttpStatusCode.Created)
}

private suspend fun RoutingContext.savePartyRoute() {
    val (userId, email) = call.principalIdAndEmail()
    val partyId = call.parseUuidParam("id") ?: return
    val request = call.receive<SavePartyRequest>()

    val outcome =
        transaction {
            ensureUser(userId, email)
            if (!ownsParty(partyId, userId)) {
                SaveOutcome.Missing
            } else {
                val problem =
                    validateParty(
                        request,
                        ownedCharacterIds(userId),
                        memberIdsOf(partyId),
                        seatsWithLootHistory(partyId),
                    )
                if (problem != null) {
                    SaveOutcome.Invalid(problem)
                } else {
                    saveParty(partyId, userId, request, Clock.System.now())
                    // Read back rather than echo the request: the seats that were kept and the
                    // ids the new ones got are the server's answer, not the client's.
                    SaveOutcome.Saved(findParty(partyId, userId)!!)
                }
            }
        }
    respondToSave(outcome, HttpStatusCode.OK)
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

private suspend fun RoutingContext.respondToSave(
    outcome: SaveOutcome,
    onSuccess: HttpStatusCode,
) {
    when (outcome) {
        is SaveOutcome.Invalid -> call.respond(HttpStatusCode.BadRequest, outcome.reason)
        is SaveOutcome.Missing -> call.respond(HttpStatusCode.NotFound)
        is SaveOutcome.Saved -> call.respond(onSuccess, outcome.party)
    }
}

/**
 * The reason this party cannot be saved, or null if it can.
 *
 * Refuses rather than repairs. Dropping an unknown boss key or trimming a seventh seat would save
 * something the user did not ask for and show it back as if they had, which is the quietly-wrong
 * answer this project is built to avoid. Must run inside a transaction: it reads the catalog.
 */
internal fun validateParty(
    request: SavePartyRequest,
    ownedCharacters: Set<Uuid>,
    existingMemberIds: Set<Uuid>,
    // Seats the loot pool points at. They cannot be dropped from the party: a payout row is the
    // record that somebody was paid, and removing the seat would erase the record while the money
    // stays real. Empty for a party being created.
    protectedMemberIds: Set<Uuid> = emptySet(),
): String? {
    val members = request.members
    val seatIds = members.mapNotNull { it.id }
    val characterIds = members.mapNotNull { it.characterId }
    val parsedCharacterIds = characterIds.mapNotNull(Uuid::parseOrNull)
    val keptSeats = seatIds.mapNotNull(Uuid::parseOrNull).toSet()

    return when {
        members.isEmpty() -> "a party needs at least one member"
        members.size > MAX_PARTY_SIZE -> "a party holds at most $MAX_PARTY_SIZE members"
        members.any { it.name.isBlank() } -> "member names must not be blank"
        seatIds.mapNotNull(Uuid::parseOrNull).size != seatIds.size -> "malformed member id"
        !existingMemberIds.containsAll(seatIds.mapNotNull(Uuid::parseOrNull)) -> "unknown member id"
        seatIds.distinct().size != seatIds.size -> "a member id may appear once"
        parsedCharacterIds.size != characterIds.size -> "malformed characterId"
        !ownedCharacters.containsAll(parsedCharacterIds) -> "characterId must be one of your characters"
        // Two seats for one character would double that character's share of every split.
        parsedCharacterIds.distinct().size != parsedCharacterIds.size ->
            "a character can hold only one seat in a party"
        !keptSeats.containsAll(protectedMemberIds) ->
            "a member with loot history cannot be removed, delete or reassign their loot first"
        bossIdsForKeys(request.bossKeys) == null -> "unknown boss key"
        else -> null
    }
}
