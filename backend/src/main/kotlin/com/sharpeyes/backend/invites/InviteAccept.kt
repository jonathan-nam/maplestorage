package com.sharpeyes.backend.invites

import com.sharpeyes.backend.db.BossCatalog
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.Person
import com.sharpeyes.backend.db.PersonCharacter
import com.sharpeyes.backend.db.Users
import com.sharpeyes.backend.parties.SavePartyRequest
import com.sharpeyes.backend.parties.createParty
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.update
import kotlin.time.Instant
import kotlin.uuid.Uuid

// Turns a frozen payload into rows on the accepting account, and links the two accounts while both
// are in reach. Everything here runs in the caller's transaction: an account half-built from a link
// is worse than one that was never built, because the guard below would then refuse to try again.

/**
 * True when nothing has been entered on this account yet.
 *
 * The gate on accepting a link. Merging into an account that already has characters, people or
 * configs means deciding whether the CreedBratton in the payload is the CreedBratton already there,
 * and every wrong answer is a duplicate person or a second config for one boss that nothing on
 * screen distinguishes from the real one. Refusing is the answer that cannot be quietly wrong.
 *
 * Must be called from inside a `transaction { }` block.
 */
internal fun accountIsEmpty(userId: String): Boolean =
    Characters.selectAll().where { Characters.userId eq userId }.empty() &&
        Person.selectAll().where { Person.userId eq userId }.empty() &&
        Party.selectAll().where { Party.userId eq userId }.empty()

/**
 * Writes [payload] onto [userId]'s account.
 *
 * Assumes the account is empty (see [accountIsEmpty]) and that the payload's version has been
 * checked. Returns what it created, including the configs it could not, which the caller shows.
 *
 * Must be called from inside a `transaction { }` block.
 */
internal fun acceptInvite(
    payload: InvitePayload,
    userId: String,
    invitePersonId: Uuid,
    now: Instant,
): AcceptedInvite {
    Users.update({ Users.id eq userId }) { it[worldType] = payload.worldType }

    val characterIds = createCharacters(payload, userId, now)
    createPeople(payload, userId, now)
    val (created, omitted) = createParties(payload, userId, characterIds, now)

    linkAccounts(payload, userId, invitePersonId, now)

    return AcceptedInvite(
        charactersCreated = characterIds.size,
        peopleCreated = payload.people.size,
        partiesCreated = created,
        omitted = payload.omitted + omitted,
    )
}

/**
 * The recipient's own characters, in the order the sender listed them.
 *
 * The sprite is copied and `sprite_checked_at` left null, so the daily refresh treats each one as
 * never asked and looks it up properly. The copy is what the roster draws in the meantime: the
 * cache is content-addressed on the URL, so these bytes are already warm and the alternative is a
 * new account whose every seat is blank until a job runs.
 */
private fun createCharacters(
    payload: InvitePayload,
    userId: String,
    now: Instant,
): Map<String, Uuid> =
    payload.characters
        .mapIndexed { index, character ->
            val id = Uuid.random()
            val sprite = payload.sprites[character.name]
            Characters.insert {
                it[Characters.id] = id
                it[Characters.userId] = userId
                it[name] = character.name
                it[worldType] = character.worldType
                it[spriteImgUrl] = sprite
                it[spriteRefreshedAt] = if (sprite != null) now else null
                it[createdAt] = now
                it[updatedAt] = now
                it[position] = index
            }
            character.name.lowercase() to id
        }.toMap()

private fun createPeople(
    payload: InvitePayload,
    userId: String,
    now: Instant,
) {
    for (person in payload.people) {
        val personId = Uuid.random()
        Person.insert {
            it[Person.id] = personId
            it[Person.userId] = userId
            it[name] = person.name
            it[createdAt] = now
            it[updatedAt] = now
        }
        person.characters.forEach { character ->
            PersonCharacter.insert {
                it[PersonCharacter.id] = Uuid.random()
                it[PersonCharacter.personId] = personId
                it[PersonCharacter.userId] = userId
                it[name] = character
            }
        }
    }
}

/**
 * Each config, through the same writer the party routes use.
 *
 * Not a hand-rolled insert: seats, shares and the looter are written by createParty, and a second
 * path that built them itself would be a second answer to what a config is the day one of them
 * changed.
 */
private fun createParties(
    payload: InvitePayload,
    userId: String,
    characterIds: Map<String, Uuid>,
    now: Instant,
): Pair<Int, List<InviteOmission>> {
    val bosses =
        BossCatalog
            .selectAll()
            .associate { it[BossCatalog.bossKey] to it[BossCatalog.id] }

    val omitted = mutableListOf<InviteOmission>()
    var created = 0

    for (party in payload.parties) {
        val bossCatalogId = bosses[party.bossKey]
        val characterId = characterIds[party.ownName.lowercase()]
        if (bossCatalogId == null || characterId == null) {
            omitted += InviteOmission(party.bossKey, party.ownName, OMITTED_UNKNOWN_BOSS)
            continue
        }

        val request =
            SavePartyRequest(
                characterId = characterId.toString(),
                bossKey = party.bossKey,
                members = party.members,
                shares = party.shares,
                difficulty = party.difficulty,
                minutes = party.minutes,
                looterName = party.looterName,
            )
        // The sprites are passed whole. Only seats that are NOT the recipient's own read them;
        // their own characters draw off the Characters rows written above.
        val partyId = createParty(userId, characterId, bossCatalogId, request, now, payload.sprites)
        pairWithSource(partyId, party.sourcePartyId, payload.senderUserId)
        created++
    }
    return created to omitted
}

/**
 * Marks the new config and the one it mirrors as the same real party.
 *
 * The sender's config keeps whatever group it already had, so a third person invited to the same
 * party joins the existing group instead of starting a rival one. A source config deleted since the
 * link was made leaves the new one ungrouped, which is what an unlinked config looks like anyway.
 */
private fun pairWithSource(
    partyId: Uuid,
    sourcePartyId: String,
    senderUserId: String,
) {
    val sourceId = Uuid.parseOrNull(sourcePartyId) ?: return
    val source =
        Party
            .selectAll()
            .where { (Party.id eq sourceId) and (Party.userId eq senderUserId) }
            .firstOrNull() ?: return

    val groupId = source[Party.groupId] ?: Uuid.random()
    Party.update({ Party.id eq sourceId }) { it[Party.groupId] = groupId }
    Party.update({ Party.id eq partyId }) { it[Party.groupId] = groupId }
}

/**
 * Records that these two accounts are two people, from both sides.
 *
 * Written here and nowhere else. This is the one moment both accounts are known at once: afterwards
 * the sender's Bro and Bro's account are joined only by character names, which cannot tell a shared
 * party from two people who happen to know the same name.
 */
private fun linkAccounts(
    payload: InvitePayload,
    userId: String,
    invitePersonId: Uuid,
    now: Instant,
) {
    Person.update({ Person.id eq invitePersonId }) {
        it[linkedUserId] = userId
        it[updatedAt] = now
    }
    val senderName = payload.people.firstOrNull { it.isSender }?.name ?: return
    Person.update({ (Person.userId eq userId) and (Person.name eq senderName) }) {
        it[linkedUserId] = payload.senderUserId
        it[updatedAt] = now
    }
}
