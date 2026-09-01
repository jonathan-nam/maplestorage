package com.sharpeyes.backend.invites

import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import kotlin.time.Duration
import kotlin.time.Duration.Companion.days

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
 * How long a link is worth sending.
 *
 * The payload is frozen when the link is made, so this also bounds how stale what it hands over can
 * be. Two weeks is long enough to sit unread in a Discord DM over a holiday and short enough that a
 * roster reorganised since is a link that has to be made again rather than one that quietly lands
 * last month's parties.
 */
val INVITE_LIFETIME: Duration = 14.days

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
