package com.maplestorage.backend.share

import com.maplestorage.backend.db.BossCatalog
import com.maplestorage.backend.db.Characters
import com.maplestorage.backend.db.Party
import com.maplestorage.backend.db.PartyMember
import com.maplestorage.backend.db.Person
import com.maplestorage.backend.db.PersonCharacter
import com.maplestorage.backend.db.Users
import com.maplestorage.backend.users.WORLD_INTERACTIVE
import org.jetbrains.exposed.v1.core.ResultRow
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.jdbc.selectAll
import kotlin.time.Clock
import kotlin.time.Instant
import kotlin.uuid.Uuid

// Reading an account into a shareable document. Must be called from inside a `transaction { }`.

/**
 * Why this account cannot be exported under [author], or null.
 *
 * The name is required rather than derived. The obvious source is the email, and putting the local
 * part of somebody's work address into a file they hand to a friend is not a default worth having.
 */
internal fun validateExport(
    userId: String,
    author: String,
): String? {
    val trimmed = author.trim()
    val taken =
        Person
            .selectAll()
            .where { Person.userId eq userId }
            .any { it[Person.name].trim().equals(trimmed, ignoreCase = true) }

    return when {
        trimmed.isEmpty() -> "a name to export under is required"
        trimmed.length > MAX_AUTHOR_NAME -> "that name is too long"
        taken -> "$trimmed is already somebody on your people list"
        else -> null
    }
}

/** Long enough for any handle, short enough that the field is not a place to write prose. */
private const val MAX_AUTHOR_NAME = 60

/**
 * This account's arrangements, as a document to hand over.
 *
 * Carries STANDING configs with their STANDING seats, and nothing else. The three kinds left out
 * are counted rather than dropped in silence (see ShareOmissions), and each is left out because it
 * is a record rather than an arrangement:
 *
 *  - retired, whose only remaining value is a pool, and a pool cannot cross
 *  - solo, which has no other people in it, so there is nothing in it for a reader
 *  - one-off, a night that happened rather than a thing that stands
 *
 * A guest seat goes for the same reason one level down: it says who ran a week, not who is in the
 * party.
 */
internal fun buildExport(
    userId: String,
    author: String,
    now: Instant = Clock.System.now(),
): ShareExportResponse {
    val worldType =
        Users
            .selectAll()
            .where { Users.id eq userId }
            .firstOrNull()
            ?.get(Users.worldType) ?: WORLD_INTERACTIVE

    val ownCharacters =
        Characters
            .selectAll()
            .where { Characters.userId eq userId }
            .orderBy(Characters.position)
            .associate { it[Characters.id] to it[Characters.name] }

    val allConfigs =
        Party
            .innerJoin(BossCatalog)
            .selectAll()
            .where { Party.userId eq userId }
            .toList()

    val carried =
        allConfigs.filter {
            it[Party.standing] && !it[Party.solo] && !it[Party.oneOff]
        }

    val seatsByParty =
        if (carried.isEmpty()) {
            emptyMap()
        } else {
            PartyMember
                .selectAll()
                .where { PartyMember.partyId inList carried.map { it[Party.id] } }
                .orderBy(PartyMember.position)
                .toList()
                .groupBy { it[PartyMember.partyId] }
        }

    val configs =
        carried
            .mapNotNull { row -> configOf(row, ownCharacters, seatsByParty[row[Party.id]].orEmpty()) }
            .sortedWith(compareBy({ it.bossKey }, { it.anchor.lowercase() }))

    val document =
        ShareDocument(
            exportedAt = now.toString(),
            author = author.trim(),
            worldType = worldType,
            people = peopleOf(userId, author.trim(), ownCharacters.values.toList()),
            configs = configs,
        )
    val omitted =
        ShareOmissions(
            retiredConfigs = allConfigs.count { !it[Party.standing] },
            soloConfigs = allConfigs.count { it[Party.standing] && it[Party.solo] },
            oneOffConfigs = allConfigs.count { it[Party.standing] && !it[Party.solo] && it[Party.oneOff] },
            guestSeats = seatsByParty.values.sumOf { seats -> seats.count { !it[PartyMember.standing] } },
        )
    return ShareExportResponse(document, omitted)
}

/**
 * One config as the file states it, or null if it is not one this account can speak for.
 *
 * [seats] is the party's whole roster; the guests are dropped here.
 */
private fun configOf(
    row: ResultRow,
    ownCharacters: Map<Uuid, String>,
    seats: List<ResultRow>,
): ShareConfig? {
    val anchor = ownCharacters[row[Party.characterId]]
    val standing =
        seats
            .filter { it[PartyMember.standing] }
            .map { ShareSeat(name = it[PartyMember.name], shares = it[PartyMember.shares]) }

    // The anchor is a seat of its own party (position 0), so a roster that has lost it has lost the
    // thing the config is anchored ON. Left out rather than repaired: a config whose owner is not
    // in its own roster is not one this can speak for.
    val anchored = anchor?.takeIf { name -> standing.any { it.name.equals(name, ignoreCase = true) } }

    return anchored?.let {
        ShareConfig(
            anchor = it,
            bossKey = row[BossCatalog.bossKey],
            difficulty = row[Party.difficulty],
            minutes = row[Party.minutes],
            seats = standing,
        )
    }
}

/**
 * Everybody in the file: the people this account has named, then the author.
 *
 * The author is last and flagged, so a reader's "which of these is you?" list reads as the people
 * first and the person handing it over after them.
 */
private fun peopleOf(
    userId: String,
    author: String,
    ownCharacters: List<String>,
): List<SharePerson> {
    val charactersByPerson =
        PersonCharacter
            .selectAll()
            .where { PersonCharacter.userId eq userId }
            .orderBy(PersonCharacter.name)
            .groupBy({ it[PersonCharacter.personId] }) { it[PersonCharacter.name] }

    val named =
        Person
            .selectAll()
            .where { Person.userId eq userId }
            .orderBy(Person.createdAt)
            .map {
                SharePerson(
                    name = it[Person.name],
                    characters = charactersByPerson[it[Person.id]].orEmpty(),
                )
            }

    return named + SharePerson(name = author, characters = ownCharacters, author = true)
}

/**
 * Why this document cannot be handed over, or null.
 *
 * The rule validateBossRoster enforces on every write since #213: a character clears a boss once a
 * period, so naming one in two configs for the same boss states something the game cannot do. That
 * check never backfilled the rows predating it, and a file is where such a pair would finally do
 * damage, in an account whose owner has no way to know which of the two is right.
 *
 * Refused here rather than flagged on the reader's side, for that reason: this is the only account
 * that can fix it.
 */
internal fun validateDocument(document: ShareDocument): String? {
    val seen = mutableMapOf<Pair<String, String>, String>()
    for (config in document.configs) {
        for (seat in config.seats) {
            val key = config.bossKey to seat.name.trim().lowercase()
            val held = seen.put(key, config.anchor)
            if (held != null) {
                return "${seat.name} is in both your $held and ${config.anchor} parties for " +
                    "${config.bossKey}, and can only run it once"
            }
        }
    }
    return null
}
