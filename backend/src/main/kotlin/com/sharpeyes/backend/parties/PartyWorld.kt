package com.sharpeyes.backend.parties

import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.users.WORLD_INTERACTIVE
import org.jetbrains.exposed.v1.core.JoinType
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.jdbc.selectAll
import kotlin.uuid.Uuid

// Which world a config plays in, and what follows from it.
//
// Split out of PartyQueries.kt, which had grown past what one file should answer for. These two are
// what the write routes ask before accepting anything a world cannot do, so they are worth finding
// in one place: the UI hides those controls, and this is what makes hiding them a rule rather than a
// suggestion.

/**
 * Which world this config plays in, or null if there is no such config.
 *
 * Through the CHARACTER, which is where a world lives: a config does not have one of its own, and
 * asking the account's ACTIVE world instead would read a config against whichever world the toggle
 * happens to be on. See activeWorldFor for the difference.
 */
internal fun partyWorld(partyId: Uuid): String? =
    Party
        .join(Characters, JoinType.INNER, Party.characterId, Characters.id)
        .selectAll()
        .where { Party.id eq partyId }
        .firstOrNull()
        ?.get(Characters.worldType)

/**
 * True when this config's drops can be sold at all.
 *
 * Heroic (Reboot) worlds do not trade, so a sale there is not a figure to get right, it is one
 * that could never have happened. Without this the payout rows a sale pins would outlive the button.
 */
internal fun partyCanSell(partyId: Uuid): Boolean = partyWorld(partyId) == WORLD_INTERACTIVE
