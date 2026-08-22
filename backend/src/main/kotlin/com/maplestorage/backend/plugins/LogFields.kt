package com.maplestorage.backend.plugins

// Cap on any logged string field, so an unauthenticated caller cannot bloat a log line.
private const val MAX_FIELD_LEN = 80

/**
 * Append " key=value" only when present, with the value sanitised.
 *
 * Shared by the two unauthenticated beacon endpoints (vitals, client errors). Anyone on the
 * internet can post to those, so a value must not be able to carry spaces or newlines and forge
 * extra fields. Keep only the characters that legitimately appear in a route, timezone or locale.
 */
internal fun StringBuilder.field(
    key: String,
    value: String?,
) {
    if (value.isNullOrBlank()) return
    val safe =
        value.take(MAX_FIELD_LEN).filter {
            it.isLetterOrDigit() || it == '/' || it == '_' || it == '.' || it == ':' || it == '-'
        }
    if (safe.isEmpty()) return
    append(' ').append(key).append('=').append(safe)
}
