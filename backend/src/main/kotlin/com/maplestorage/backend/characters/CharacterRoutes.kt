package com.maplestorage.backend.characters

import com.maplestorage.backend.db.Characters
import com.maplestorage.backend.plugins.parseUuidParam
import com.maplestorage.backend.plugins.principalIdAndEmail
import com.maplestorage.backend.plugins.span
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
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import org.jetbrains.exposed.v1.jdbc.update
import kotlin.time.Clock
import kotlin.uuid.Uuid

fun Route.characterRoutes(nexonLookupService: NexonLookupService) {
    post { createCharacter(nexonLookupService) }
    get { listCharacters() }
    // Registered BEFORE /{id}, or the parameter route swallows the literal.
    get("/tokens") { getAllCharacterTokens() }
    // Literal before /{id}, or the parameter route swallows it (same as /tokens above).
    put("/order") { reorderCharacters() }
    get("/{id}") { getCharacter() }
    put("/{id}") { updateCharacter() }
    post("/{id}/refresh") { refreshCharacter(nexonLookupService) }
    get("/{id}/tokens") { getCharacterTokens() }
    delete("/{id}") { deleteCharacter() }
}

private suspend fun RoutingContext.createCharacter(nexonLookupService: NexonLookupService) {
    val (userId, email) = call.principalIdAndEmail()
    val request = call.receive<CreateCharacterRequest>()
    if (request.name.isBlank()) {
        call.respond(HttpStatusCode.BadRequest, "name must not be blank")
        return
    }

    val lookup = call.span("nexon") { nexonLookupService.lookup(request.name) }
    val now = Clock.System.now()
    val newId = Uuid.random()

    val created =
        transaction {
            ensureUser(userId, email)
            // Append to the end of this user's carousel. position is dense, so the count is
            // the next free slot.
            val nextPosition =
                Characters
                    .selectAll()
                    .where { Characters.userId eq userId }
                    .count()
                    .toInt()
            Characters.insert {
                it[id] = newId
                it[Characters.userId] = userId
                it[name] = request.name
                it[level] = lookup?.level
                it[jobName] = lookup?.jobName
                it[spriteImgUrl] = lookup?.spriteImgUrl
                it[spriteRefreshedAt] = if (lookup != null) now else null
                it[createdAt] = now
                it[updatedAt] = now
                it[position] = nextPosition
            }
            findOwnedCharacter(newId, userId)
        }

    call.respond(HttpStatusCode.Created, created!!)
}

private suspend fun RoutingContext.listCharacters() {
    val (userId, email) = call.principalIdAndEmail()
    val characters =
        transaction {
            ensureUser(userId, email)
            Characters
                .selectAll()
                .where { Characters.userId eq userId }
                .orderBy(Characters.position)
                .map { it.toCharacterResponse() }
        }
    call.respond(characters)
}

private suspend fun RoutingContext.reorderCharacters() {
    val (userId, email) = call.principalIdAndEmail()
    val request = call.receive<ReorderCharactersRequest>()

    val parsed = request.orderedIds.map { runCatching { Uuid.parse(it) }.getOrNull() }
    if (parsed.any { it == null }) {
        call.respond(HttpStatusCode.BadRequest, "orderedIds contains an invalid id")
        return
    }
    val order = parsed.filterNotNull()

    val reordered =
        transaction {
            ensureUser(userId, email)
            val owned =
                Characters
                    .selectAll()
                    .where { Characters.userId eq userId }
                    .map { it[Characters.id] }
                    .toSet()
            // Must be exactly this user's set, no missing, extra or duplicate ids, or position
            // would end up with holes or collisions.
            if (order.size != owned.size || order.toSet() != owned) {
                return@transaction null
            }
            order.forEachIndexed { index, characterId ->
                Characters.update({ (Characters.id eq characterId) and (Characters.userId eq userId) }) {
                    it[position] = index
                }
            }
            Characters
                .selectAll()
                .where { Characters.userId eq userId }
                .orderBy(Characters.position)
                .map { it.toCharacterResponse() }
        }

    if (reordered == null) {
        call.respond(HttpStatusCode.BadRequest, "orderedIds must be exactly your characters, once each")
    } else {
        call.respond(reordered)
    }
}

private suspend fun RoutingContext.getCharacter() {
    val (userId, email) = call.principalIdAndEmail()
    val characterId = call.parseUuidParam("id") ?: return

    val character =
        transaction {
            ensureUser(userId, email)
            findOwnedCharacter(characterId, userId)
        }
    respondFoundOrNotFound(character)
}

private suspend fun RoutingContext.updateCharacter() {
    val (userId, email) = call.principalIdAndEmail()
    val characterId = call.parseUuidParam("id") ?: return
    val request = call.receive<UpdateCharacterRequest>()

    val updated =
        transaction {
            ensureUser(userId, email)
            val rowsChanged =
                Characters.update({ (Characters.id eq characterId) and (Characters.userId eq userId) }) { row ->
                    request.name?.let { row[Characters.name] = it }
                    request.level?.let { row[Characters.level] = it }
                    row[Characters.updatedAt] = Clock.System.now()
                }
            if (rowsChanged == 0) null else findOwnedCharacter(characterId, userId)
        }
    respondFoundOrNotFound(updated)
}

private suspend fun RoutingContext.refreshCharacter(nexonLookupService: NexonLookupService) {
    val (userId, email) = call.principalIdAndEmail()
    val characterId = call.parseUuidParam("id") ?: return

    val existingName =
        transaction {
            ensureUser(userId, email)
            findOwnedCharacter(characterId, userId)?.name
        }
    if (existingName == null) {
        call.respond(HttpStatusCode.NotFound)
        return
    }

    val lookup = call.span("nexon") { nexonLookupService.lookup(existingName) }
    val refreshed =
        transaction {
            // A transient lookup failure leaves existing level/job/sprite
            // untouched rather than nulling out previously-good data.
            if (lookup != null) {
                Characters.update({ (Characters.id eq characterId) and (Characters.userId eq userId) }) { row ->
                    row[level] = lookup.level
                    row[jobName] = lookup.jobName
                    row[spriteImgUrl] = lookup.spriteImgUrl
                    row[spriteRefreshedAt] = Clock.System.now()
                    row[updatedAt] = Clock.System.now()
                }
            }
            findOwnedCharacter(characterId, userId)
        }
    call.respond(refreshed!!)
}

private suspend fun RoutingContext.deleteCharacter() {
    val (userId, email) = call.principalIdAndEmail()
    val characterId = call.parseUuidParam("id") ?: return

    val rowsDeleted =
        transaction {
            ensureUser(userId, email)
            Characters.deleteWhere { (Characters.id eq characterId) and (Characters.userId eq userId) }
        }
    if (rowsDeleted == 0) {
        call.respond(HttpStatusCode.NotFound)
    } else {
        call.respond(HttpStatusCode.NoContent)
    }
}

private suspend fun RoutingContext.respondFoundOrNotFound(character: CharacterResponse?) {
    if (character == null) {
        call.respond(HttpStatusCode.NotFound)
    } else {
        call.respond(character)
    }
}
