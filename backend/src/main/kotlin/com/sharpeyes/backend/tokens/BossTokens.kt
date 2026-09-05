package com.sharpeyes.backend.tokens

import com.sharpeyes.backend.db.TokenCatalog
import org.jetbrains.exposed.v1.core.Op
import org.jetbrains.exposed.v1.core.eq

/**
 * The inventory counts boss tokens and nothing else.
 *
 * Symbols and consumables are still in the catalog, still seeded, and a capture is still parsed for
 * them. They are simply not what this app tracks, so they are filtered out of every read and
 * refused by the write, rather than deleted: the rows a user already holds survive, and widening
 * the scope again is this one predicate.
 *
 * `item_group` is the axis on purpose. It is what SECTIONS the grid, so filtering on it is the same
 * question the screen asks ("which section is this in"), and dropping the other two groups leaves
 * exactly the one that is kept.
 */
const val BOSS_TOKEN_GROUP = "Eternal Pieces"

/**
 * Applied at EVERY token read and at the write.
 *
 * One predicate rather than a filter per call site: the grid, the search and the + all answer
 * "which items exist" from different queries, and three copies of this rule is three chances for
 * them to disagree about it silently.
 */
fun isBossToken(): Op<Boolean> = TokenCatalog.itemGroup eq BOSS_TOKEN_GROUP
