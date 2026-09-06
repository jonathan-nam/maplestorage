package com.sharpeyes.backend.invites

import com.sharpeyes.backend.db.AccountInvite
import com.sharpeyes.backend.db.BossCatalog
import com.sharpeyes.backend.db.Person
import com.sharpeyes.backend.plugins.principalIdAndEmail
import com.sharpeyes.backend.users.ensureUser
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.call
import io.ktor.server.request.receive
import io.ktor.server.request.receiveNullable
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.RoutingContext
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.route
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.encodeToJsonElement
import org.jetbrains.exposed.v1.core.JoinType
import org.jetbrains.exposed.v1.core.ResultRow
import org.jetbrains.exposed.v1.core.SortOrder
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import org.jetbrains.exposed.v1.jdbc.update
import kotlin.time.Clock
import kotlin.uuid.Uuid

// A link that starts somebody else's account from your side of the parties you share. Three
// audiences, and they are not the same person: the sender makes links, anybody holding one can see
// what it offers, and the recipient redeems it once signed in.
//
// Two kinds of link, told apart by whether the row names a person. One is addressed to somebody the
// sender already holds characters and configs for and carries them; the other names nobody, and the
// recipient supplies the one character it needs. See OpenInviteAccept.kt and V76.
//
// Nothing here takes a link back. It expires on its own (INVITE_LIFETIME), and making a new one for
// somebody deletes the one it replaces, which between them are the two ways a link stops working.

/** Strict on purpose. A stored payload with a field we do not know is one to refuse, not to guess at. */
private val payloadJson = Json

fun Route.inviteRoutes() {
    get { listInvitesRoute() }
    post { createInviteRoute() }
    // Before /{token}/accept only in the reading: one segment against two, so neither can swallow
    // the other. A link for somebody with no row to address, which is the whole difference: see V76.
    post("/open") { createOpenInviteRoute() }
    post("/{token}/accept") { acceptInviteRoute() }
}

/**
 * What one link offers, to somebody not signed in.
 *
 * Mounted outside the authenticated block, because the whole point is to be readable before there
 * is an account: a landing page that demanded a sign-in first would ask people to create an account
 * to find out whether they want one. The token is the authority, and it is the only one.
 */
fun Route.joinRoutes() {
    route("/api/join") {
        get("/{token}") { previewInviteRoute() }
    }
}

private suspend fun RoutingContext.listInvitesRoute() {
    val (userId, email) = call.principalIdAndEmail()
    val invites =
        transaction {
            ensureUser(userId, email)
            AccountInvite
                // LEFT: a link for somebody new names no person, and an inner join would answer
                // that it does not exist.
                .join(Person, JoinType.LEFT, AccountInvite.personId, Person.id)
                .selectAll()
                .where { AccountInvite.userId eq userId }
                .orderBy(AccountInvite.createdAt to SortOrder.DESC)
                .map { it.toInviteResponse(token = null) }
        }
    call.respond(invites)
}

/**
 * Makes a link for one person.
 *
 * The token comes back once, here, and is never recoverable: only its hash is stored. Any earlier
 * unaccepted link for the same person is deleted first, so "invite" is one live link per person
 * rather than a pile of them that all still work.
 */
private suspend fun RoutingContext.createInviteRoute() {
    val (userId, email) = call.principalIdAndEmail()
    val request = call.receive<CreateInviteRequest>()
    val personId = Uuid.parseOrNull(request.personId)

    if (personId == null) {
        call.respond(HttpStatusCode.BadRequest, "malformed personId")
        return
    }

    val now = Clock.System.now()
    val token = newInviteToken()
    val created =
        transaction {
            ensureUser(userId, email)
            // Derived, never sent: the client does not tell the server the user's own name.
            val senderName = senderNameFor(userId) ?: return@transaction null
            val payload = buildInvitePayload(userId, personId, senderName) ?: return@transaction null

            AccountInvite.deleteWhere {
                (AccountInvite.userId eq userId) and
                    (AccountInvite.personId eq personId) and
                    (AccountInvite.acceptedAt eq null)
            }

            val id = Uuid.random()
            AccountInvite.insert {
                it[AccountInvite.id] = id
                it[AccountInvite.userId] = userId
                it[AccountInvite.personId] = personId
                it[tokenHash] = hashInviteToken(token)
                it[AccountInvite.senderName] = senderName
                it[AccountInvite.payload] = payloadJson.encodeToJsonElement(payload)
                it[createdAt] = now
                it[expiresAt] = now + INVITE_LIFETIME
            }
            AccountInvite
                // INNER, unlike the reads that can meet a link naming nobody: this one is the row
                // just inserted, and its person is what made it.
                .join(Person, JoinType.INNER, AccountInvite.personId, Person.id)
                .selectAll()
                .where { AccountInvite.id eq id }
                .single()
                .toInviteResponse(token)
        }

    if (created == null) {
        call.respond(HttpStatusCode.NotFound, "no such person, or no character to send the link as")
    } else {
        call.respond(HttpStatusCode.Created, created)
    }
}

private suspend fun RoutingContext.previewInviteRoute() {
    val token = call.parameters["token"].orEmpty()
    val preview = transaction { invitePreviewFor(token) }
    if (preview == null) call.respond(HttpStatusCode.NotFound) else call.respond(preview)
}

/**
 * What one link says about itself, or null where there is nothing to say.
 *
 * Apart from the route because this is the only thing on the site an unauthenticated caller can
 * read, and what it does and does not include is worth being able to test without one.
 *
 * Must be called from inside a `transaction { }` block.
 */
internal fun invitePreviewFor(token: String): InvitePreview? {
    val (invite, payload) = liveInviteFor(token) ?: return null
    val bossNames =
        BossCatalog
            .selectAll()
            .associate { it[BossCatalog.bossKey] to it[BossCatalog.name] }
    // The key itself where this build does not know the boss, which is a link made against a newer
    // catalog. Unreadable beats absent: the count is what the page leans on, and a missing row
    // would understate it.
    val parties =
        payload.parties.map {
            InvitePartyLabel(bossNames[it.bossKey] ?: it.bossKey, it.difficulty)
        }
    return InvitePreview(
        senderName = payload.senderName,
        // Which of the two questions the landing page asks. An open link's characters and parties
        // are empty because there are none to show, and a page that could not tell that from a
        // person with no parties would ask nobody for anything.
        open = invite[AccountInvite.personId] == null,
        characters = payload.characters.map { it.name },
        parties = parties,
        peopleCount = payload.people.size,
        omitted = payload.omitted,
    )
}

/**
 * Redeems a link into the signed-in account.
 *
 * Which half of the body is read depends on the kind of link, because the two ask opposite
 * questions. A link addressed to a person shows the sender's spelling of the recipient's characters
 * and takes back the ones they confirmed; an open link has none to show and takes the one character
 * they name. Told apart by the row's person, which only an open link leaves empty.
 *
 * A body that takes nothing is refused rather than obeyed, either way. It would spend the token and
 * write nothing, and a link that reports success having done nothing is the worst of both.
 *
 * The account itself need not be empty: both paths bind a character it already has rather than
 * making a second one.
 */
private suspend fun RoutingContext.acceptInviteRoute() {
    val (userId, email) = call.principalIdAndEmail()
    val token = call.parameters["token"].orEmpty()
    val now = Clock.System.now()
    val request = call.receiveNullable<AcceptInviteRequest>()
    // Absent is every character in the payload, which is what a client that does not ask sends.
    val confirmed = request?.characters

    val outcome =
        transaction {
            ensureUser(userId, email)
            val (invite, payload) = liveInviteFor(token) ?: return@transaction Refusal.Unknown
            if (payload.version != INVITE_PAYLOAD_VERSION) return@transaction Refusal.Stale
            // Redeeming your own link would link an account to itself, and on an open link would
            // make the account a person on its own people board.
            if (invite[AccountInvite.userId] == userId) return@transaction Refusal.Own

            val personId = invite[AccountInvite.personId]
            val refused = unspentRefusal(personId, payload, userId, request)
            if (refused != null) return@transaction Refusal.Said(refused)

            // Spent before the rows are written, inside the same transaction: two requests racing
            // the same link both pass the checks above, and the unique token_hash does not stop the
            // second because it is an update, not an insert. This does, by matching only the row
            // that is still unaccepted.
            val spent =
                AccountInvite.update({
                    (AccountInvite.id eq invite[AccountInvite.id]) and (AccountInvite.acceptedAt eq null)
                }) {
                    it[acceptedAt] = now
                    it[acceptedBy] = userId
                } > 0
            if (!spent) return@transaction Refusal.Unknown

            if (personId == null) {
                acceptOpenInvite(payload, userId, request?.character.orEmpty(), now)
            } else {
                acceptInvite(payload, userId, confirmed, personId, now)
            }
        }

    when (outcome) {
        Refusal.Unknown -> call.respond(HttpStatusCode.NotFound)
        Refusal.Stale -> call.respond(HttpStatusCode.Gone, "this link is out of date, ask for a new one")
        Refusal.Own -> call.respond(HttpStatusCode.Conflict, "this is your own link")
        is Refusal.Said -> call.respond(HttpStatusCode.BadRequest, outcome.reason)
        is AcceptedInvite -> call.respond(outcome)
        else -> call.respond(HttpStatusCode.NotFound)
    }
}

/**
 * Why this body cannot be redeemed against this link, or null.
 *
 * Everything that leaves the link UNSPENT, so the same one still works once the recipient knows
 * what to answer. Each kind of link asks its own question, and both are asked here rather than
 * after the row is spent, which is the whole reason they are gathered into one place.
 *
 * Must be called from inside a `transaction { }` block.
 */
private fun unspentRefusal(
    personId: Uuid?,
    payload: InvitePayload,
    userId: String,
    request: AcceptInviteRequest?,
): String? =
    when {
        personId == null -> openInviteRefusal(payload, userId, request?.character)
        request?.characters?.isEmpty() == true -> "tick at least one character that is yours"
        else -> null
    }

/** Why a link was not redeemed. One type so the transaction can return either it or the result. */
private sealed interface Refusal {
    data object Unknown : Refusal

    data object Stale : Refusal

    data object Own : Refusal

    /**
     * A reason in the recipient's own words, from whichever kind of link refused it.
     *
     * Carried rather than enumerated because the open path's reasons name things: the character
     * they typed, and the sender who already knows it. An enum here would be a set of cases that
     * exists only to be turned back into those sentences somewhere else.
     */
    data class Said(
        val reason: String,
    ) : Refusal
}

/**
 * The invite a token names, if it is still good, with its payload read out.
 *
 * Unknown, expired and already accepted are one answer on purpose: three that a caller holding a
 * token could tell apart would say whether a token ever existed.
 *
 * Must be called from inside a `transaction { }` block.
 */
private fun liveInviteFor(token: String): Pair<ResultRow, InvitePayload>? {
    if (token.isEmpty()) return null
    return AccountInvite
        .selectAll()
        .where { AccountInvite.tokenHash eq hashInviteToken(token) }
        .firstOrNull()
        ?.takeIf { it[AccountInvite.acceptedAt] == null }
        ?.takeIf { it[AccountInvite.expiresAt] >= Clock.System.now() }
        ?.let { it to payloadJson.decodeFromJsonElement(it[AccountInvite.payload]) }
}

internal fun ResultRow.toInviteResponse(token: String?): InviteResponse {
    val payload: InvitePayload = payloadJson.decodeFromJsonElement(this[AccountInvite.payload])
    return InviteResponse(
        id = this[AccountInvite.id].toString(),
        personId = this[AccountInvite.personId]?.toString(),
        personName = getOrNull(Person.name),
        senderName = this[AccountInvite.senderName],
        token = token,
        createdAt = this[AccountInvite.createdAt].toString(),
        expiresAt = this[AccountInvite.expiresAt].toString(),
        accepted = this[AccountInvite.acceptedAt] != null,
        characterCount = payload.characters.size,
        partyCount = payload.parties.size,
        omitted = payload.omitted,
    )
}
