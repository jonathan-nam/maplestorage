package com.maplestorage.backend.parties

import com.maplestorage.backend.bosses.parseWeekParam
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
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import kotlin.time.Clock
import kotlin.uuid.Uuid

// A config is one of your characters, on one boss, with the people that character runs it with.
// The character and the boss are what it IS, so they are set once, at create.

fun Route.partyRoutes(nexonLookupService: NexonLookupService) {
    get { listParties() }
    post { createPartyRoute(nexonLookupService) }
    // Before /{id}, and matched ahead of it whatever the order: Ktor scores a constant segment
    // above a parameter. Every pool at once, for the wallet, and the wallet's one settle back.
    get("/loot") { listAllLoot() }
    // A drop logged by character and boss rather than by pool, for the Drop Log. See logDropRoute.
    post("/loot") { logDropRoute() }
    post("/loot/settle") { settleRoute() }
    get("/{id}") { getParty() }
    put("/{id}") { savePartyRoute(nexonLookupService) }
    put("/{id}/roster") { saveWeekRosterRoute(nexonLookupService) }
    put("/{id}/clear") { setClearRoute() }
    put("/{id}/skip") { setSkipRoute() }
    delete("/{id}") { deletePartyRoute() }
    route("/{id}/loot") { lootRoutes() }
}

/**
 * Every config, for the current week by default or one past week with `?week=YYYY-MM-DD`.
 *
 * The week does not change which configs come back. It changes the pool counts each one carries,
 * which is what lets Party View's drop badges answer for the same week as the ticks beside them.
 * See lootCountsFor for what a week admits.
 *
 * `?solo=include` adds the pools for bosses run alone. Off by default: they are not parties, and a
 * caller that draws a roster or plans a night would be showing a party of one.
 */
private suspend fun RoutingContext.listParties() {
    val (userId, email) = call.principalIdAndEmail()
    val week =
        parseWeekParam(call.request.queryParameters["week"]).getOrElse {
            return call.respond(HttpStatusCode.BadRequest, it.message.orEmpty())
        }
    val includeSolo = call.request.queryParameters["solo"] == "include"
    val parties =
        transaction {
            ensureUser(userId, email)
            partiesFor(userId, week, includeSolo)
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

/**
 * Makes the config, or fills in the one a solo pool already opened for this pair.
 *
 * Logging a drop on a boss nobody else was there for opens a solo config (see createSoloParty),
 * and it holds the same unique slot a party would. Saying who you run it with is not a second
 * config for the pair, it is that one becoming a party, so it is adopted rather than refused. The
 * drops already in the pool stay where they are, and adoptSoloParty pins the weeks they fell in.
 */
private suspend fun RoutingContext.createPartyRoute(nexonLookupService: NexonLookupService) {
    val (userId, email) = call.principalIdAndEmail()
    val request = call.receive<SavePartyRequest>()
    val sprites = lookUpSprites(userId, request.members, email, nexonLookupService)

    val outcome =
        transaction {
            val characterId = Uuid.parseOrNull(request.characterId)
            val bossId = bossIdForKey(request.bossKey)
            // Ownership first, so a characterId that is not this user's cannot reach a config
            // through the pair lookup, which does not filter by user.
            val solo =
                if (characterId == null || bossId == null || !ownsCharacter(characterId, userId)) {
                    null
                } else {
                    partyIdFor(characterId, bossId)?.takeIf { isSoloParty(it) }
                }
            if (solo != null) {
                val problem = validateSavedParty(userId, solo, request)
                if (problem != null) {
                    problem
                } else {
                    adoptSoloParty(userId, solo, request, Clock.System.now(), sprites)
                    findParty(solo, userId)!!
                }
            } else {
                val problem = validateNewParty(request, userId, characterId, bossId)
                if (problem != null) {
                    problem
                } else {
                    val id = createParty(userId, characterId!!, bossId!!, request, Clock.System.now(), sprites)
                    findParty(id, userId)!!
                }
            }
        }
    respondToSave(outcome, HttpStatusCode.Created)
}

private suspend fun RoutingContext.savePartyRoute(nexonLookupService: NexonLookupService) {
    val (userId, email) = call.principalIdAndEmail()
    val partyId = call.parseUuidParam("id") ?: return
    val request = call.receive<SavePartyRequest>()
    val sprites = lookUpSprites(userId, request.members, email, nexonLookupService)

    val outcome =
        transaction {
            if (!ownsParty(partyId, userId)) {
                null
            } else {
                val problem = validateSavedParty(userId, partyId, request)
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
 * Says who ran this week, or puts the week back to the usual party.
 *
 * This week only. A past week's payouts were pinned when its drops sold and are never re-derived,
 * so rewriting who ran back then would leave the roster and the money owed disagreeing, with
 * nothing on screen to say which of the two is right.
 *
 * The party's own roster is untouched: that is what PUT /{id} is for.
 */
private suspend fun RoutingContext.saveWeekRosterRoute(nexonLookupService: NexonLookupService) {
    val (userId, email) = call.principalIdAndEmail()
    val partyId = call.parseUuidParam("id") ?: return
    val request = call.receive<SaveWeekRosterRequest>()
    val asked =
        parseWeekParam(request.week).getOrElse {
            return call.respond(HttpStatusCode.BadRequest, it.message.orEmpty())
        }
    val sprites = lookUpSprites(userId, request.members.orEmpty(), email, nexonLookupService)

    val outcome =
        transaction {
            ensureUser(userId, email)
            val characterId = characterIdOfParty(partyId)
            val thisWeek = currentWeek()
            // Omitted means this week, which is also the only one allowed. Taken from the server's
            // clock rather than the payload so a browser a day out cannot file a roster in the
            // neighbouring week.
            val problem =
                if (asked != null && asked != thisWeek) {
                    "only this week's party can be changed"
                } else {
                    request.members?.let { members ->
                        validateMembers(members)
                            ?: bossIdOfParty(partyId)?.let { boss ->
                                validateWeekRoster(
                                    userId,
                                    boss,
                                    exclude = partyId,
                                    thisWeek,
                                    rosterOf(characterId, members),
                                )
                            }
                    }
                }
            when {
                !ownsParty(partyId, userId) || characterId == null -> null
                problem != null -> problem
                else -> {
                    val context = SeatContext(userId, sprites, Clock.System.now())
                    saveWeekRoster(partyId, characterId, thisWeek, request.members, context)
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
                // record rather than a setting. All time, not the shown week: a settled drop from
                // months ago is exactly the record this refuses to discard.
                lootCountsFor(listOf(partyId), week = null).isNotEmpty() ->
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

internal suspend fun RoutingContext.respondToSave(
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
