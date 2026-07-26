package com.maplestorage.backend.parties

import com.maplestorage.backend.plugins.principalIdAndEmail
import com.maplestorage.backend.users.ensureUser
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.call
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.RoutingContext
import io.ktor.server.routing.get
import io.ktor.server.routing.put
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import kotlin.time.Clock

// Who plays which character. Separate from the configs on purpose: a config names characters, and
// this says whose they are, once, for every config that names them.

fun Route.peopleRoutes() {
    get { listPeople() }
    put { savePeopleRoute() }
}

private suspend fun RoutingContext.listPeople() {
    val (userId, email) = call.principalIdAndEmail()
    val people =
        transaction {
            ensureUser(userId, email)
            peopleFor(userId)
        }
    call.respond(people)
}

private suspend fun RoutingContext.savePeopleRoute() {
    val (userId, email) = call.principalIdAndEmail()
    val request = call.receive<SavePeopleRequest>()

    val outcome =
        transaction {
            ensureUser(userId, email)
            val problem = validatePeople(request)
            if (problem != null) {
                problem
            } else {
                savePeople(userId, request, Clock.System.now())
                peopleFor(userId)
            }
        }
    when (outcome) {
        is String -> call.respond(HttpStatusCode.BadRequest, outcome)
        else -> call.respond(outcome)
    }
}

/**
 * Why this people list cannot be saved, or null.
 *
 * A character belongs to one person: the game's names are unique in a world, so two people
 * claiming the same one is a mistake, and letting it through would make "whose is this?" a
 * question with two answers.
 */
internal fun validatePeople(request: SavePeopleRequest): String? {
    val names = request.people.map { it.name.trim() }
    val characters =
        request.people
            .flatMap { person -> person.characters.map { it.trim() } }
            .filter { it.isNotEmpty() }
            .map { it.lowercase() }

    return when {
        names.any { it.isBlank() } -> "a person needs a name"
        names.map { it.lowercase() }.distinct().size != names.size -> "two people share a name"
        characters.distinct().size != characters.size -> "two people claim the same character"
        else -> null
    }
}
