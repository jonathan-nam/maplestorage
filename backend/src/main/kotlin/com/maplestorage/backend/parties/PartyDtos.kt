package com.maplestorage.backend.parties

import kotlinx.serialization.Serializable

// Mirrored by the frontend's types/party.ts field-for-field.

/**
 * One seat: a character somebody brought.
 *
 * `personName` is not stored on the seat. It comes from person_character, matched on the character
 * name, so "CreedBratton is Chris's" is stated once and every config that names CreedBratton shows
 * it. Null means that character has not been attributed to anybody yet, which is ordinary.
 */
@Serializable
data class PartyMemberResponse(
    val id: String,
    val name: String,
    val personId: String?,
    val personName: String?,
    // Set when the seat is one of YOUR characters, which happens when you bring two of your own.
    val characterId: String?,
    val spriteImgUrl: String?,
    // Not in the party's usual roster: here for this week only, or gone from it since. Said out
    // loud because "who is in this party" and "who ran it that week" now have different answers.
    val guest: Boolean = false,
)

/**
 * One config: your character, one boss, and who they run it with.
 *
 * A boss your character solos has no config, which is why solo runs do not appear anywhere. The
 * members are the OTHER characters; your own is `characterId` on the config itself.
 */
@Serializable
data class PartyResponse(
    val id: String,
    val characterId: String,
    // The character's world, INTERACTIVE or HEROIC. Carried on the config because it is what
    // decides whether this pool's drops can be sold at all: Heroic worlds do not trade, so a
    // split, a payout and a wallet line are all figures that could never change hands.
    val worldType: String,
    val bossKey: String,
    // Which mode this party runs, one of the boss's own difficulties. Null is not NORMAL, it is
    // nobody having said yet, so nothing draws a difficulty for it.
    val difficulty: String? = null,
    // Who ran in the week being shown, which is not always who usually does. See rostersFor.
    val members: List<PartyMemberResponse>,
    // EVERY seat this party has ever had, guests and departed members included. What a payout is
    // read against: a share owed to somebody who has since left is still owed, and resolving it
    // through `members` would make the drop unreadable the week after they left.
    val seats: List<PartyMemberResponse> = emptyList(),
    // False when this week was spelled out with its own roster. The members alone cannot say so: a
    // week that only drops somebody names no guest and would read as an ordinary one.
    val usualRoster: Boolean = true,
    // The pool at a glance: dropped but unsold, and sold with somebody still unpaid.
    val pendingLoot: Int = 0,
    val awaitingPayout: Int = 0,
    // Sold and settled. Sent so a fully-settled pool still shows on the row: without it, paying
    // the last share made the party's whole drop history disappear from the list.
    val settledLoot: Int = 0,
    // Whether this boss is cleared in the period it is currently in, straight out of boss_clear:
    // the same row the clear matrix draws and a planner capture writes. Null means nobody has said
    // anything about it this period, which is not the same as "not cleared".
    val cleared: Boolean? = null,
    // Ticked here rather than read off a planner. A number you can trace to a capture and one
    // somebody typed are not equally trustworthy, so the two are not drawn identically.
    val clearedByHand: Boolean = false,
    val createdAt: String,
    val updatedAt: String,
)

/** A person, and the characters of theirs you have named. */
@Serializable
data class PersonResponse(
    val id: String,
    val name: String,
    val characters: List<String>,
)

/**
 * A config, as submitted.
 *
 * `members` is the other characters, in the order they should read. Empty is refused: a config
 * with nobody else in it is a solo run, and a solo run is simply not a config.
 */
@Serializable
data class SavePartyRequest(
    val characterId: String,
    val bossKey: String,
    val members: List<String> = emptyList(),
    // One of the boss's own difficulties, or null for "not said". Anything else is refused rather
    // than dropped: a config claiming Normal Black Mage would read as a fact somebody entered.
    val difficulty: String? = null,
)

/**
 * The whole people list, every time.
 *
 * A full replace, because it is one screen you edit as a whole. A person absent from the payload
 * has been removed, and one whose characters shrink has had those attributions taken back; the
 * configs naming those characters keep the characters and simply stop showing an owner.
 */
@Serializable
data class SavePeopleRequest(
    val people: List<PersonRequest> = emptyList(),
)

@Serializable
data class PersonRequest(
    val id: String? = null,
    val name: String,
    val characters: List<String> = emptyList(),
)

/**
 * Who ran this week, as submitted.
 *
 * A null `members` puts the week back to the usual roster, which is a deletion rather than a copy
 * of it: copying would leave a week frozen against every later change to the party.
 *
 * `week` names the week being changed, and only the current one may be. A past week's payouts were
 * pinned when the drops sold, so rewriting who ran then would leave the roster and the money owed
 * disagreeing, with nothing on screen saying which is right.
 */
@Serializable
data class SaveWeekRosterRequest(
    val week: String? = null,
    val members: List<String>? = null,
)

/** Ticking a config's boss cleared for the period it is in, or un-ticking it. */
@Serializable
data class SetClearRequest(
    val cleared: Boolean,
)
