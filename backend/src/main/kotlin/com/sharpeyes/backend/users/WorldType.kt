package com.sharpeyes.backend.users

import com.sharpeyes.backend.db.Users
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.jdbc.selectAll

// The two kinds of GMS world, as users.world_type, characters.world_type and drop_catalog.worlds
// all spell them. One list, so a third spelling cannot appear.

const val WORLD_INTERACTIVE = "INTERACTIVE"
const val WORLD_HEROIC = "HEROIC"

val WORLD_TYPES = setOf(WORLD_INTERACTIVE, WORLD_HEROIC)

/**
 * Which world the account is looking at right now.
 *
 * `users.world_type` is a MODE, not a claim about the account: one account holds characters in
 * both, and toggling picks which half of them the whole site answers for. Every account-wide read
 * narrows by it, so a figure on screen is always "in this world", never a silent sum across two
 * that cannot be added.
 *
 * It is also what a new character is created in, which needs no separate setting: you add a
 * character in the world you are looking at.
 *
 * Must be called from inside a `transaction { }` block.
 */
fun activeWorldFor(userId: String): String =
    Users
        .selectAll()
        .where { Users.id eq userId }
        .single()[Users.worldType]

/**
 * The value if it is one of the two, else null.
 *
 * Refusing an unknown world beats storing it: the CHECK constraint would reject it anyway, and a
 * 500 from a violated constraint tells the caller nothing about which field was wrong.
 */
fun worldTypeOrNull(raw: String?): String? = raw?.uppercase()?.takeIf { it in WORLD_TYPES }
