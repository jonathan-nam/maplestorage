package com.maplestorage.backend.parties

import kotlinx.serialization.Serializable

// Mirrored by the frontend's types/party.ts field-for-field.

@Serializable
data class PersonResponse(
    val id: String,
    val name: String,
    // The Auction House tier this person pays on a payout. One answer per person, not per party.
    val mvp: Boolean,
)

@Serializable
data class PartyMemberResponse(
    val id: String,
    // Which person holds the seat. The grid's column.
    val personId: String,
    // What the cell says: the character, or a label for it ("2nd mech").
    val name: String,
    // The character's real name when the label is not it. Null means `name` is already the IGN.
    // This is what the sprite lookup and the link to your roster use.
    val ign: String? = null,
    // Set when this seat is one of the caller's characters, null when it is somebody else. The
    // parties page groups by exactly this, so a character can be shown the parties it is in.
    val characterId: String?,
    // Copied from the person so a split does not need a second request to work out a fee. The
    // rate itself lives in frontend/lib/drop-split.ts; sending a status keeps it there.
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
