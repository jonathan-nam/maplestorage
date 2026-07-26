package com.maplestorage.backend.parties

import kotlinx.serialization.Serializable

// The party grid: one column per person, one row per party, and the character they bring in the
// cell. It is how the roster is kept by hand (test-fixtures/occluded/boss matrix.png), and it is
// the app's only editing surface for parties, so the two cannot drift apart.

@Serializable
data class PartyGridResponse(
    // Columns, in the order the grid draws them.
    val people: List<PersonResponse>,
    // Rows. Each carries its seats, which name the person and the character.
    val parties: List<PartyResponse>,
)

/**
 * A column, as submitted.
 *
 * `key` is how seats point at this person within one save. For a person who already exists it is
 * their id; for one being added it is anything the client made up. Without it a new column could
 * not be referenced by the cells created alongside it, and the save would need two round trips.
 */
@Serializable
data class GridPersonRequest(
    val key: String,
    val id: String? = null,
    val name: String,
    val mvp: Boolean = false,
)

/**
 * One filled cell: this person, on this character, in this party. Empty cells are simply absent.
 *
 * `characterName` is what the cell says, which may be a label ("2nd mech"). `ign` is who that
 * actually is, and it is what the sprite lookup and the roster link use. Leave it out when the
 * cell already holds the character's real name.
 */
@Serializable
data class GridSeatRequest(
    val personKey: String,
    val characterName: String,
    val ign: String? = null,
)

@Serializable
data class GridPartyRequest(
    val id: String? = null,
    val name: String? = null,
    val bossKeys: List<String> = emptyList(),
    val seats: List<GridSeatRequest> = emptyList(),
)

/**
 * The whole grid, every time.
 *
 * A full replace, like the single-party save it grew out of: the grid IS the roster, so a row or a
 * column that is not in the payload has been removed. Removals that loot history points at are
 * refused rather than performed, and the reason says which.
 */
@Serializable
data class SaveGridRequest(
    val people: List<GridPersonRequest> = emptyList(),
    val parties: List<GridPartyRequest> = emptyList(),
)
