package com.maplestorage.backend.sprites

import java.security.MessageDigest

/**
 * The backend path that serves a Nexon sprite URL's bytes.
 *
 * A pure function of the URL, which is what makes it usable from the DTO mappers: they can hand the
 * frontend a path without knowing whether the bytes have been fetched yet, and the route sorts out
 * hit, miss and never-heard-of-it. Nothing else may build this string, or a change here would leave
 * one caller pointing at a path the route does not serve.
 */
fun spriteProxyPath(nexonUrl: String): String = "$SPRITE_PROXY_PREFIX/${spriteKey(nexonUrl)}.png"

const val SPRITE_PROXY_PREFIX = "/character-sprites"

// sha256 as lowercase hex. Also the width of `character_sprite.url_sha256`, which reads it from
// here so the column and the key it stores cannot drift apart.
const val SPRITE_KEY_LENGTH = 64

/** Lowercase hex sha256 of the URL, the primary key of `character_sprite`. */
fun spriteKey(nexonUrl: String): String =
    MessageDigest
        .getInstance("SHA-256")
        .digest(nexonUrl.toByteArray())
        .joinToString("") { "%02x".format(it) }

/**
 * The key out of a `{key}.png` path segment, or null if it is not one this service could have
 * issued.
 *
 * Checked rather than trusted: the key reaches SQL, and 64 lowercase hex characters is the whole of
 * what [spriteKey] can produce.
 */
fun spriteKeyFromSegment(segment: String): String? =
    segment
        .removeSuffix(".png")
        .takeIf { it.length == SPRITE_KEY_LENGTH && it.all { c -> c in "0123456789abcdef" } }
