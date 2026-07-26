package com.maplestorage.backend.bosses

import com.maplestorage.backend.plugins.principalIdAndEmail
import com.maplestorage.backend.users.ensureUser
import io.ktor.http.HttpStatusCode
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.RoutingContext
import io.ktor.server.routing.get
import kotlinx.datetime.LocalDate
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import kotlin.time.Clock

fun Route.bossRoutes() {
    get { listBosses() }
    get("/clears") { getCurrentBossClears() }
    get("/drops") { getDropTables() }
}

// Every boss's drop table, from catalog/drops.yaml. Served rather than shipped in the frontend
// for the reason the boss catalog is: adding a drop stays a one-file change.
internal suspend fun RoutingContext.getDropTables() {
    val (userId, email) = call.principalIdAndEmail()
    val tables =
        transaction {
            ensureUser(userId, email)
            dropTables()
        }
    call.respond(tables)
}

// The catalog itself, in progression order. Served rather than shipped in the frontend so the
// matrix's columns come from catalog/bosses.yaml like everything else does, and adding a boss
// stays a one-file change.
internal suspend fun RoutingContext.listBosses() {
    val (userId, email) = call.principalIdAndEmail()
    val bosses =
        transaction {
            ensureUser(userId, email)
            bossCatalog()
        }
    call.respond(bosses)
}

/**
 * The matrix's data: the current period by default, or one past week with `?week=YYYY-MM-DD`.
 *
 * A malformed or off-boundary week is refused rather than served as an empty matrix. An empty
 * matrix is indistinguishable from a real week nobody captured, so answering one for a Tuesday
 * would be a confident wrong answer instead of a 400.
 */
internal suspend fun RoutingContext.getCurrentBossClears() {
    val (userId, email) = call.principalIdAndEmail()
    val now = Clock.System.now()
    val requested = call.request.queryParameters["week"]

    val week =
        if (requested == null) {
            null
        } else {
            val parsed =
                try {
                    LocalDate.parse(requested)
                } catch (_: IllegalArgumentException) {
                    return call.respond(HttpStatusCode.BadRequest, "malformed week, expected YYYY-MM-DD")
                }
            if (!isPeriodStart(WEEKLY_CADENCE, parsed)) {
                return call.respond(HttpStatusCode.BadRequest, "week must be a reset day (Thursday, UTC)")
            }
            parsed
        }

    val currentWeek = periodStartFor(WEEKLY_CADENCE, now)
    val view =
        transaction {
            ensureUser(userId, email)
            // Shown week for navigation purposes: the current view is the current week, it just
            // draws the other two cadences as well.
            val shown = week ?: currentWeek
            val navigation = weekNavigation(shown, currentWeek, earliestWeekStartFor(userId))
            val clears =
                if (week == null) currentBossClearsFor(userId, now) else weeklyClearsFor(userId, week)
            BossClearsViewResponse(
                clearsByCharacter = clears,
                weekStart = week?.toString(),
                previousWeekStart = navigation.previous?.toString(),
                nextWeekStart = navigation.next?.toString(),
                currentWeekStart = currentWeek.toString(),
                nextResets = RESET_CADENCES.associateWith { nextResetAfter(it, now).toString() },
                now = now.toString(),
            )
        }
    call.respond(view)
}
