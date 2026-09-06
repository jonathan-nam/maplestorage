package com.sharpeyes.backend.invites

import com.sharpeyes.backend.db.AccountInvite
import com.sharpeyes.backend.db.Person
import com.sharpeyes.backend.plugins.principalIdAndEmail
import com.sharpeyes.backend.users.activeWorldFor
import com.sharpeyes.backend.users.ensureUser
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.call
import io.ktor.server.response.respond
import io.ktor.server.routing.RoutingContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.encodeToJsonElement
import org.jetbrains.exposed.v1.core.JoinType
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.isNull
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import kotlin.time.Clock
import kotlin.time.Instant
import kotlin.uuid.Uuid

// Making a link for somebody with no row to address. Its own file next to InviteRoutes.kt, which
// answers for the kind that names a person: the two share a table, a token and a landing page, and
// differ in what they can possibly carry. See OpenInviteAccept.kt for what redeeming one does.

private val payloadJson = Json

/**
 * Makes a link for nobody in particular.
 *
 * No body, because there is nothing to say: the sender is naming no person, and the world and the
 * name it is sent under are the account's own. What comes back is one live link, the same as the
 * person route's, and making another replaces it.
 *
 * The payload is an InvitePayload with nothing in it but the sender, which is a true account of what
 * this hands over. Frozen for the same reason as any other: the world decides which of the
 * recipient's characters the link can be about, and a sender who toggles worlds in the next five
 * minutes must not change what an already-sent link means.
 */
internal suspend fun RoutingContext.createOpenInviteRoute() {
    val (userId, email) = call.principalIdAndEmail()
    val now = Clock.System.now()
    val token = newInviteToken()

    val made =
        transaction {
            ensureUser(userId, email)
            makeOpenLink(userId, token, now)
        }

    when (made) {
        is OpenLink.Made -> call.respond(HttpStatusCode.Created, made.invite)
        // Neither is a thing the sender could have been told before pressing: an account with no
        // character has no name to send a link under, and one with no world has no world to send it
        // for.
        is OpenLink.No -> call.respond(HttpStatusCode.Conflict, made.reason)
    }
}

/**
 * The link itself, apart from the request that asked for it.
 *
 * Here rather than inside the route so the row it writes and the row it reads back can be tested
 * without a signed-in caller. The read is the half worth pinning: an open link joins to no person,
 * so it comes back through a LEFT join that an inner one would answer as a missing invite.
 *
 * Must be called from inside a `transaction { }` block.
 */
internal fun makeOpenLink(
    userId: String,
    token: String,
    now: Instant,
): OpenLink {
    val senderName = senderNameFor(userId)
    val world = activeWorldFor(userId)
    // Two ways to have no link to make, refused together because detekt allows one early return. An
    // account with no character has no name to send a link under, since every person on this app is
    // named after one; an account with no world has no world to send it for (V74).
    if (senderName == null || world == null) {
        return OpenLink.No(if (senderName == null) "add a character first" else "choose a world first")
    }

    // One live link per account, which is what making another means. The person path says the same
    // of one live link per person, and neither is backed by an index: see V76.
    AccountInvite.deleteWhere {
        (AccountInvite.userId eq userId) and
            AccountInvite.personId.isNull() and
            (AccountInvite.acceptedAt eq null)
    }

    val id = Uuid.random()
    AccountInvite.insert {
        it[AccountInvite.id] = id
        it[AccountInvite.userId] = userId
        it[personId] = null
        it[tokenHash] = hashInviteToken(token)
        it[AccountInvite.senderName] = senderName
        it[payload] = payloadJson.encodeToJsonElement(openPayload(userId, senderName, world))
        it[createdAt] = now
        it[expiresAt] = now + INVITE_LIFETIME
    }
    return OpenLink.Made(
        AccountInvite
            .join(Person, JoinType.LEFT, AccountInvite.personId, Person.id)
            .selectAll()
            .where { AccountInvite.id eq id }
            .single()
            .toInviteResponse(token),
    )
}

/** A link made, or why it could not be. */
internal sealed interface OpenLink {
    data class Made(
        val invite: InviteResponse,
    ) : OpenLink

    data class No(
        val reason: String,
    ) : OpenLink
}

/**
 * What an open link carries: the sender, and nothing of anybody else's.
 *
 * Their main character is in it because that is the name a friend recognises them by, and the person
 * row the recipient ends up with is named after it. Everything else an InvitePayload can hold is
 * about parties the two of them share, and by definition they share none yet.
 */
internal fun openPayload(
    userId: String,
    senderName: String,
    world: String,
): InvitePayload =
    InvitePayload(
        version = INVITE_PAYLOAD_VERSION,
        senderName = senderName,
        senderUserId = userId,
        worldType = world,
        characters = emptyList(),
        people = listOf(InvitePerson(senderName, listOf(senderName), isSender = true)),
        parties = emptyList(),
    )
