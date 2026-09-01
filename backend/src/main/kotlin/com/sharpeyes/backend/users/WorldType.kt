package com.sharpeyes.backend.users

import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Users
import org.jetbrains.exposed.v1.core.Op
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.jdbc.selectAll

// The two kinds of GMS world, as users.world_type, characters.world_type and drop_catalog.worlds
// all spell them. One list, so a third spelling cannot appear.

const val WORLD_INTERACTIVE = "INTERACTIVE"
const val WORLD_HEROIC = "HEROIC"

val WORLD_TYPES = setOf(WORLD_INTERACTIVE, WORLD_HEROIC)

/**
 * Which world the account is looking at right now, or null if it has never said.
 *
 * `users.world_type` is a MODE, not a claim about the account: one account holds characters in
 * both, and toggling picks which half of them the whole site answers for. Every account-wide read
 * narrows by it, so a figure on screen is always "in this world", never a silent sum across two
 * that cannot be added.
 *
 * It is also what a new character is created in when the Nexon lookup cannot say, which needs no
 * separate setting: you add a character in the world you are looking at.
 *
 * Null is not a third world to render, and it is never a reason to substitute one. It means the
 * account has not been asked yet, which is what V71 made expressible: before it, unanswered and
 * INTERACTIVE were the same value and a Heroic player was silently shown the wrong one.
 *
 * Must be called from inside a `transaction { }` block.
 */
fun activeWorldFor(userId: String): String? =
    Users
        .selectAll()
        .where { Users.id eq userId }
        .single()[Users.worldType]

/**
 * The predicate narrowing characters to the account's world, matching NOTHING while unanswered.
 *
 * Every account-wide read goes through this rather than comparing to activeWorldFor directly, so
 * there is one place deciding what an unanswered account sees. Empty is the honest answer: with no
 * lens chosen there is no world these rows are in, and guessing one is how a Heroic account gets
 * shown an Interactive pool. The screen that asks the question is what resolves it.
 */
fun inActiveWorld(userId: String): Op<Boolean> = activeWorldFor(userId)?.let { Characters.worldType eq it } ?: Op.FALSE

/**
 * The value if it is one of the two, else null.
 *
 * Refusing an unknown world beats storing it: the CHECK constraint would reject it anyway, and a
 * 500 from a violated constraint tells the caller nothing about which field was wrong.
 */
fun worldTypeOrNull(raw: String?): String? = raw?.uppercase()?.takeIf { it in WORLD_TYPES }
