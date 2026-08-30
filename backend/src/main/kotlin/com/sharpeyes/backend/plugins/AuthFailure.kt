package com.sharpeyes.backend.plugins

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import java.util.Base64

private const val BEARER = "Bearer "
private const val JWT_SEGMENTS = 3

/**
 * Why a request failed to authenticate, as one greppable token.
 *
 * A bare 401 cannot tell a browser whose session had not loaded yet from one whose token had
 * expired, and those want opposite fixes. Both were guessed at for an hour from a log that said
 * only `GET /api/parties 401 3ms`, so the guess is now written down at the point it is known.
 */
internal fun authFailureReason(
    header: String?,
    nowEpochSeconds: Long,
): String {
    val token =
        header
            ?.takeIf { it.startsWith(BEARER, ignoreCase = true) }
            ?.substring(BEARER.length)
            ?.trim()
    return when {
        header == null -> "no-header"
        token == null -> "not-bearer"
        token.isEmpty() -> "empty-token"
        // A client bug, not a probe: a template literal interpolated a token that had not arrived
        // yet, so the four characters `null` went out as the credential. Worth its own name
        // because it looks identical to an expired token in every other respect.
        token == "null" || token == "undefined" -> "null-token"
        token.split(".").size != JWT_SEGMENTS -> "malformed-token"
        isExpired(token, nowEpochSeconds) -> "expired-token"
        else -> "rejected-token"
    }
}

private fun isExpired(
    token: String,
    nowEpochSeconds: Long,
): Boolean {
    val expiry = expiryOf(token) ?: return false
    return expiry < nowEpochSeconds
}

/**
 * The `exp` claim, read WITHOUT verifying the signature.
 *
 * Only ever used to label a request that is already being rejected. Nothing here may decide
 * whether to reject, which is what makes reading an unverified payload safe.
 */
private fun expiryOf(token: String): Long? =
    runCatching {
        val payload = Base64.getUrlDecoder().decode(token.split(".")[1]).decodeToString()
        Json
            .parseToJsonElement(payload)
            .jsonObject["exp"]
            ?.jsonPrimitive
            ?.longOrNull
    }.getOrNull()
