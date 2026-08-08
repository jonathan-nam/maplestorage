package com.maplestorage.backend.parties

import com.maplestorage.backend.bosses.parseWeekParam
import com.maplestorage.backend.plugins.parseUuidParam
import com.maplestorage.backend.plugins.principalIdAndEmail
import com.maplestorage.backend.users.ensureUser
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.call
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.RoutingContext
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import kotlin.time.Clock

// One route, in a file of its own, as the drop log's is. See LootLogRoute.kt.

/**
 * Takes this boss off the period, or puts it back, leaving the config where it is.
 *
 * A week off is not the party ending. Saying it by deleting the config would take the seats and the
 * pool with it and need retyping next Thursday, which is why the mark is a row of its own and why
 * going back to the config's default is that row's deletion.
 *
 * One route for both kinds of config, because the question is the same one. What differs is which
 * way the default runs: a standing party is on until this says otherwise, a one-off is off until it
 * does. setRunsInPeriod picks the table.
 *
 * This period only, the same rule the week roster keeps: a past period's pool was settled against
 * what actually happened, and re-answering "did you run it" afterwards would leave the two
 * disagreeing with nothing on screen saying which is right.
 *
 * The period is the boss's own, not the Thursday week, so a Black Mage taken off is off the month.
 */
internal suspend fun RoutingContext.setSkipRoute() {
    val (userId, email) = call.principalIdAndEmail()
    val partyId = call.parseUuidParam("id") ?: return
    val request = call.receive<SetPartySkipRequest>()
    val asked =
        parseWeekParam(request.week).getOrElse {
            return call.respond(HttpStatusCode.BadRequest, it.message.orEmpty())
        }

    val outcome =
        transaction {
            ensureUser(userId, email)
            val now = Clock.System.now()
            val reset = bossIdOfParty(partyId)?.let(::bossResetOf)
            when {
                !ownsParty(partyId, userId) || reset == null -> null
                // Omitted means this week, which is also the only one allowed. Taken from the
                // server's clock rather than the payload, so a browser a day out cannot take a boss
                // off the neighbouring week.
                asked != null && asked != currentWeek() -> "only this week can be changed"
                else -> {
                    setRunsInPeriod(
                        partyId,
                        isOneOff(partyId),
                        periodShown(reset, week = null, now = now),
                        runs = !request.skipped,
                        now = now,
                    )
                    findParty(partyId, userId)
                }
            }
        }
    respondToSave(outcome, HttpStatusCode.OK)
}
