package com.maplestorage.backend.parties

import kotlinx.serialization.Serializable

// Mirrored by the frontend's types/party.ts field-for-field.

@Serializable
data class PartyMemberResponse(
    val id: String,
    val name: String,
    // Set when this seat is one of the caller's characters, null when it is somebody else. The
    // parties page groups by exactly this, so a character can be shown the parties it is in.
    val characterId: String?,
    // Whether this member pays the MVP Auction House rate on a payout. The rate itself lives in
    // frontend/lib/drop-split.ts; sending a status rather than a number keeps it there.
    val mvp: Boolean,
    // The seat's sprite: the linked character's own when there is one, otherwise whatever the
    // Nexon lookup found for that name. Null is ordinary (a typo, an unranked character), and the
    // client draws initials for it.
    val spriteImgUrl: String? = null,
)

@Serializable
data class PartyResponse(
    val id: String,
    // Null when the party was never named. The client labels it from its members rather than
    // inventing a name here, which would then have to be maintained as the roster changed.
    val name: String?,
    val members: List<PartyMemberResponse>,
    // Which bosses this party is for, as catalog keys in progression order.
    val bossKeys: List<String>,
    // The loot pool at a glance: what has dropped and not sold, and what has sold with somebody
    // still unpaid. Counted server side so the list page does not fetch every party's pool.
    val pendingLoot: Int = 0,
    val awaitingPayout: Int = 0,
    val createdAt: String,
    val updatedAt: String,
)

/**
 * One seat, as submitted.
 *
 * `id` is what separates an edit from a replacement: a seat sent with its id keeps that row, so a
 * rename or an MVP toggle does not delete and re-create the member. Loot payouts reference member
 * rows, and re-creating one would drop the record of who had already been paid.
 */
@Serializable
data class PartyMemberRequest(
    val id: String? = null,
    val name: String,
    val characterId: String? = null,
    val mvp: Boolean = false,
)

/**
 * The whole party, every time. A create and a save take the same body.
 *
 * Deliberately a full replace rather than a patch: the members list and the boss list are sets a
 * user edits as a whole ("this party runs these three bosses"), and a partial update of a set has
 * no unambiguous meaning. Seats absent from `members` are removed.
 */
@Serializable
data class SavePartyRequest(
    val name: String? = null,
    val members: List<PartyMemberRequest> = emptyList(),
    val bossKeys: List<String> = emptyList(),
)
