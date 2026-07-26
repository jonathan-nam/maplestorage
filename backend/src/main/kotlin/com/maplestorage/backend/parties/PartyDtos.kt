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
    val bossKey: String,
    val members: List<PartyMemberResponse>,
    // The pool at a glance: dropped but unsold, and sold with somebody still unpaid.
    val pendingLoot: Int = 0,
    val awaitingPayout: Int = 0,
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

/** Ticking a config's boss cleared for the period it is in, or un-ticking it. */
@Serializable
data class SetClearRequest(
    val cleared: Boolean,
)
