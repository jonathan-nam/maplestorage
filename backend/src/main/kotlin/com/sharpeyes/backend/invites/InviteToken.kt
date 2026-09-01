package com.sharpeyes.backend.invites

import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import kotlin.time.Duration
import kotlin.time.Duration.Companion.minutes

// The credential in a sign-on link. Everything about it follows from one fact: the link IS the
// authority. Anyone holding the URL can redeem it, so it has to be unguessable, short-lived, spent
// once, and absent from the database that would otherwise be a list of live invites.

/**
 * 256 bits, which is not a number to tune.
 *
 * The preview behind a token is unauthenticated, so the only thing standing between a stranger and
 * somebody's roster is that the token cannot be found by trying. At this width it cannot.
 */
private const val TOKEN_BYTES = 32

/**
 * How long a link works for.
 *
 * This is the whole of how a link is taken back: it goes stale on its own, and nobody is asked to
 * remember to stop it. There was a Revoke button and it was the wrong shape, because it made
 * somebody responsible for a credential they should be able to forget about.
 *
 * Five minutes, which makes this a code you read out while the two of you are talking rather than
 * something to send and forget. A link that goes anywhere it should not is worthless before anyone
 * could act on it, and the payload it carries is frozen when it is made, so it cannot go stale
 * either.
 *
 * The cost is deliberate and worth saying out loud: a link left in a Discord DM overnight will not
 * work in the morning. Making another is one press, and the page that refuses an old one says so.
 */
val INVITE_LIFETIME: Duration = 5.minutes

private val random = SecureRandom()

/** A fresh token, URL-safe and unpadded so it survives being pasted anywhere. */
fun newInviteToken(): String {
    val bytes = ByteArray(TOKEN_BYTES)
    random.nextBytes(bytes)
    return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
}

/**
 * What is stored in place of the token: sha256, hex.
 *
 * No salt and no work factor, deliberately. This is not a password: it is 256 bits of uniform
 * randomness, so there is no dictionary to run and nothing for a slow hash to buy. What the hash is
 * for is that a dump of `account_invite` grants nobody anything.
 */
fun hashInviteToken(token: String): String =
    MessageDigest
        .getInstance("SHA-256")
        .digest(token.toByteArray())
        .joinToString("") { "%02x".format(it) }
