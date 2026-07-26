package com.maplestorage.backend.parties

import kotlin.uuid.Uuid

/**
 * The reason this grid cannot be saved, or null if it can.
 *
 * Refuses rather than repairs, like the save it replaced. Trimming a seventh seat, dropping an
 * unknown boss key or quietly keeping a column the user removed would all save something they did
 * not ask for and then show it back as if they had.
 *
 * Must run inside a transaction: it reads the catalog and the loot history.
 */
internal fun validateGrid(
    request: SaveGridRequest,
    userId: String,
    ownedPersonIds: Set<Uuid>,
    ownedPartyIds: Set<Uuid>,
): String? {
    val keys = request.people.map { it.key }
    val names = request.people.map { it.name.trim() }
    val personIds = request.people.mapNotNull { it.id }
    val parsedPersonIds = personIds.mapNotNull(Uuid::parseOrNull)
    val partyIds = request.parties.mapNotNull { it.id }
    val parsedPartyIds = partyIds.mapNotNull(Uuid::parseOrNull)
    val keptPeople = parsedPersonIds.toSet()
    val keptParties = parsedPartyIds.toSet()

    return when {
        keys.distinct().size != keys.size -> "each person needs its own key"
        names.any { it.isBlank() } -> "a person needs a name"
        // Case-insensitive, because two columns called "Jared" and "jared" are one person as far as
        // anybody reading the grid is concerned, and the database's unique index is not.
        names.map { it.lowercase() }.distinct().size != names.size -> "two people share a name"
        parsedPersonIds.size != personIds.size -> "malformed person id"
        !ownedPersonIds.containsAll(parsedPersonIds) -> "unknown person id"
        parsedPartyIds.size != partyIds.size -> "malformed party id"
        !ownedPartyIds.containsAll(parsedPartyIds) -> "unknown party id"
        else -> validateRows(request, keys.toSet(), keptPeople, keptParties, userId)
    }
}

private fun validateRow(
    party: GridPartyRequest,
    keys: Set<String>,
    seatedPeople: Set<Uuid>,
    owedHere: Set<Uuid>,
): String? {
    val seatKeys = party.seats.map { it.personKey }
    return when {
        party.seats.isEmpty() -> "a party needs at least one member"
        party.seats.size > MAX_PARTY_SIZE -> "a party holds at most $MAX_PARTY_SIZE members"
        party.seats.any { it.characterName.isBlank() } -> "a filled cell needs a character name"
        !keys.containsAll(seatKeys) -> "a cell names somebody who is not in the grid"
        // Two cells for one person in one row would double that person's share of a split.
        seatKeys.distinct().size != seatKeys.size -> "a person can hold only one seat in a party"
        bossIdsForKeys(party.bossKeys) == null -> "unknown boss key"
        // Emptying a cell deletes that seat, and a payout row points at it.
        !seatedPeople.containsAll(owedHere) ->
            "a person with loot history cannot be removed, delete or reassign their loot first"
        else -> null
    }
}

private fun validateRows(
    request: SaveGridRequest,
    keys: Set<String>,
    keptPeople: Set<Uuid>,
    keptParties: Set<Uuid>,
    userId: String,
): String? {
    val owed = seatPeopleWithLootHistory(userId)
    val personIdByKey =
        request.people.associate { it.key to it.id?.let(Uuid::parseOrNull) }

    val rowProblem =
        request.parties.firstNotNullOfOrNull { party ->
            val seatedPeople = party.seats.mapNotNull { personIdByKey[it.personKey] }.toSet()
            val required = party.id?.let(Uuid::parseOrNull)?.let { owed[it] } ?: emptySet()
            validateRow(party, keys, seatedPeople, required)
        }

    // Removals last, because they are about what is MISSING from the payload rather than what is
    // wrong in it, and the message has to name the thing that would be destroyed.
    return when {
        rowProblem != null -> rowProblem
        partiesWithLoot(userId).any { it !in keptParties } ->
            "a party with loot in its pool cannot be removed, clear its pool first"
        owed.values.flatten().any { it !in keptPeople } ->
            "a person with loot history cannot be removed, delete or reassign their loot first"
        else -> null
    }
}
