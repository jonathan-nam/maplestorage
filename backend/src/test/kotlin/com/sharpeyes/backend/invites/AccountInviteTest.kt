package com.sharpeyes.backend.invites

import com.sharpeyes.backend.config.Env
import com.sharpeyes.backend.db.AccountInvite
import com.sharpeyes.backend.db.BossClear
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyMember
import com.sharpeyes.backend.db.Person
import com.sharpeyes.backend.db.PersonCharacter
import com.sharpeyes.backend.parties.PersonRequest
import com.sharpeyes.backend.parties.SavePartyRequest
import com.sharpeyes.backend.parties.SavePeopleRequest
import com.sharpeyes.backend.parties.bossIdForKey
import com.sharpeyes.backend.parties.createParty
import com.sharpeyes.backend.parties.savePeople
import com.sharpeyes.backend.users.ensureUser
import kotlinx.datetime.LocalDate
import org.flywaydb.core.Flyway
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.or
import org.jetbrains.exposed.v1.jdbc.Database
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import org.jetbrains.exposed.v1.jdbc.update
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.time.Clock
import kotlin.uuid.Uuid

/**
 * A sign-on link, against a real Postgres.
 *
 * The claim under test is an inversion: the sender's "mechyfechy runs Kalos with CreedBratton" has
 * to arrive on the recipient's account as "CreedBratton runs Kalos with mechyfechy", with the seat
 * that is now theirs bound to a character row and the one that is now somebody else's not. Getting
 * that backwards produces an account that looks entirely plausible and describes the wrong person's
 * parties, which is the failure this repo exists to prevent, so it is pinned here rather than
 * inspected once by hand.
 *
 * The other half is what must NOT travel: loot, clears, and every config the recipient has no seat
 * in.
 */
class AccountInviteTest {
    private val senderId = "user_test_invite_sender"
    private val recipientId = "user_test_invite_recipient"
    private val thirdId = "user_test_invite_third"

    @BeforeTest
    fun migrate() {
        val jdbcUrl = "jdbc:postgresql://${Env.dbHost}:${Env.dbPort}/${Env.dbName}"
        Flyway
            .configure()
            .dataSource(jdbcUrl, Env.dbUsername, Env.dbPassword)
            .load()
            .migrate()
        Database.connect(
            url = jdbcUrl,
            driver = "org.postgresql.Driver",
            user = Env.dbUsername,
            password = Env.dbPassword,
        )
    }

    @AfterTest
    fun cleanUp() {
        transaction {
            val owned =
                Characters
                    .selectAll()
                    .where {
                        (Characters.userId eq senderId) or (Characters.userId eq recipientId) or
                            (Characters.userId eq thirdId)
                    }.map { it[Characters.id] }
            owned.forEach { id -> BossClear.deleteWhere { characterId eq id } }
            // account_invite cascades off both, but the invite's own user_id is the one that keeps
            // a sender's row alive after their person is gone.
            AccountInvite.deleteWhere {
                (AccountInvite.userId eq senderId) or (AccountInvite.userId eq recipientId) or
                    (AccountInvite.userId eq thirdId)
            }
            Party.deleteWhere {
                (Party.userId eq senderId) or (Party.userId eq recipientId) or
                    (Party.userId eq thirdId)
            }
            Person.deleteWhere {
                (Person.userId eq senderId) or (Person.userId eq recipientId) or
                    (Person.userId eq thirdId)
            }
            Characters.deleteWhere {
                (Characters.userId eq senderId) or (Characters.userId eq recipientId) or
                    (Characters.userId eq thirdId)
            }
        }
    }

    @Test
    fun `the config arrives anchored on the character that received it`() {
        transaction {
            val mine = addCharacter(senderId, "mechyfechy", position = 0)
            attribute("Bro", "CreedBratton")
            config(mine, "kalos-the-guardian", listOf("CreedBratton"))

            invite("Bro")

            val theirs = partiesOf(recipientId)
            assertEquals(1, theirs.size)
            val party = theirs.single()

            // The config now belongs to THEIR character, not to a copy of the sender's.
            assertEquals("CreedBratton", nameOf(party[Party.characterId]))
            // Same roster, other end: their character first (the config is theirs), then the
            // sender's, who is now the seat with no character row behind it.
            assertEquals(listOf("CreedBratton", "mechyfechy"), seatNamesOf(party[Party.id]))
            assertNotNull(seatFor(party[Party.id], "CreedBratton")[PartyMember.characterId])
            assertNull(seatFor(party[Party.id], "mechyfechy")[PartyMember.characterId])
        }
    }

    @Test
    fun `the difficulty, the run time and who loots travel, because they are the arrangement`() {
        transaction {
            val mine = addCharacter(senderId, "mechyfechy", position = 0)
            attribute("Bro", "CreedBratton")
            val request =
                SavePartyRequest(
                    characterId = mine.toString(),
                    bossKey = "kalos-the-guardian",
                    members = listOf("CreedBratton"),
                    shares = mapOf("CreedBratton" to 2),
                    difficulty = "CHAOS",
                    minutes = 12,
                    // The looter is the point of the whole feature: an Interactive party settles
                    // on one person picking everything up, and the arrangement is a fact about
                    // the party rather than about whose account recorded it.
                    looterName = "CreedBratton",
                )
            createParty(senderId, mine, bossIdForKey("kalos-the-guardian")!!, request, Clock.System.now())

            invite("Bro")

            val party = partiesOf(recipientId).single()
            assertEquals("CHAOS", party[Party.difficulty])
            assertEquals(12, party[Party.minutes])
            assertEquals("CreedBratton", nameOf(party[Party.looterMemberId]!!, seat = true))
            assertEquals(2, seatFor(party[Party.id], "CreedBratton")[PartyMember.shares])
        }
    }

    @Test
    fun `only the configs the recipient sits in travel`() {
        transaction {
            val mine = addCharacter(senderId, "mechyfechy", position = 0)
            attribute("Bro", "CreedBratton")
            config(mine, "kalos-the-guardian", listOf("CreedBratton"))
            // Somebody else's party, and a boss the sender runs alone. Neither is the recipient's
            // to receive: one has no seat of theirs, and the other has no seats at all.
            config(mine, "baldrix", listOf("Lynn"))
            solo(mine, "limbo")

            val payload = payloadFor("Bro")
            assertEquals(listOf("kalos-the-guardian"), payload.parties.map { it.bossKey })
        }
    }

    @Test
    fun `a second config on the same boss is named rather than dropped`() {
        transaction {
            val first = addCharacter(senderId, "mechyfechy", position = 0)
            val second = addCharacter(senderId, "acornacorn", position = 1)
            attribute("Bro", "CreedBratton")
            config(first, "kalos-the-guardian", listOf("CreedBratton"))
            config(second, "kalos-the-guardian", listOf("CreedBratton"))

            val payload = payloadFor("Bro")

            // One character runs one boss, so the second cannot also become theirs. The count that
            // changed is said, which is the whole difference between this and losing a config.
            assertEquals(1, payload.parties.size)
            assertEquals(1, payload.omitted.size)
            assertEquals("kalos-the-guardian", payload.omitted.single().bossKey)
            assertEquals(OMITTED_DUPLICATE_BOSS, payload.omitted.single().reason)

            val accepted = accept(payload, "Bro")
            assertEquals(1, accepted.partiesCreated)
            assertEquals(1, accepted.omitted.size)
        }
    }

    @Test
    fun `the people list names the sender and whoever else was in the party`() {
        transaction {
            val mine = addCharacter(senderId, "mechyfechy", position = 0)
            attribute("Bro", "CreedBratton")
            attribute("Chris", "Lynn")
            // Somebody the sender knows who is in none of the shared configs. The rest of an
            // address book is not part of what one friend hands another.
            attribute("Dwight", "Beetsss")
            config(mine, "kalos-the-guardian", listOf("CreedBratton", "Lynn"))

            invite("Bro")

            val people = peopleOf(recipientId)
            assertEquals(setOf("Jonathan", "Chris"), people.keys)
            assertEquals(listOf("mechyfechy"), people.getValue("Jonathan"))
            assertEquals(listOf("Lynn"), people.getValue("Chris"))
        }
    }

    @Test
    fun `accepting links the two accounts from both ends`() {
        transaction {
            val mine = addCharacter(senderId, "mechyfechy", position = 0)
            attribute("Bro", "CreedBratton")
            val source = config(mine, "kalos-the-guardian", listOf("CreedBratton"))

            invite("Bro")

            // The sender's Bro is now an account, and the recipient's copy of the sender is too.
            // Written at the one moment both are known: afterwards the only thing joining them is
            // a character name, which cannot tell a shared party from a coincidence.
            assertEquals(recipientId, personRow(senderId, "Bro")[Person.linkedUserId])
            assertEquals(senderId, personRow(recipientId, "Jonathan")[Person.linkedUserId])

            // And the two configs are marked as one real party, which is what a shared pool would
            // later join on.
            val theirs = partiesOf(recipientId).single()
            val group = theirs[Party.groupId]
            assertNotNull(group)
            assertEquals(group, partyRow(source)[Party.groupId])
        }
    }

    @Test
    fun `a third person invited to the same party joins the group rather than starting a rival`() {
        transaction {
            val mine = addCharacter(senderId, "mechyfechy", position = 0)
            attribute("Bro", "CreedBratton")
            attribute("Chris", "Lynn")
            val source = config(mine, "kalos-the-guardian", listOf("CreedBratton", "Lynn"))

            invite("Bro")
            val group = partyRow(source)[Party.groupId]
            assertNotNull(group)

            // The sender's config keeps the group it already has, so all three accounts describe
            // one party rather than two pairs describing two.
            invite("Chris", into = thirdId)
            assertEquals(group, partyRow(source)[Party.groupId])
            assertEquals(group, partiesOf(thirdId).single()[Party.groupId])
        }
    }

    @Test
    fun `nothing that happened travels, only what the party is`() {
        transaction {
            val mine = addCharacter(senderId, "mechyfechy", position = 0)
            attribute("Bro", "CreedBratton")
            config(mine, "kalos-the-guardian", listOf("CreedBratton"))
            BossClear.insert {
                it[characterId] = mine
                it[bossCatalogId] = bossIdForKey("kalos-the-guardian")!!
                it[periodStart] = LocalDate(2026, 8, 27)
                it[cleared] = true
                it[capturedAt] = Clock.System.now()
            }

            invite("Bro")

            // A link describes the party, not the sender's record of what it did. A clear that
            // arrived with it would be this account claiming a kill it has no evidence for.
            val theirCharacters = charactersOf(recipientId)
            val clears =
                BossClear
                    .selectAll()
                    .where { BossClear.characterId eq theirCharacters.getValue("creedbratton") }
                    .count()
            assertEquals(0L, clears)
        }
    }

    @Test
    fun `an account that already holds anything is refused`() {
        transaction {
            val mine = addCharacter(senderId, "mechyfechy", position = 0)
            attribute("Bro", "CreedBratton")
            config(mine, "kalos-the-guardian", listOf("CreedBratton"))

            assertTrue(accountIsEmpty(recipientId))
            addCharacter(recipientId, "SomebodyElse", position = 0)
            // Merging would mean deciding whether the CreedBratton in the payload is the one
            // already here, and a wrong answer reads exactly like a right one.
            assertFalse(accountIsEmpty(recipientId))
        }
    }

    @Test
    fun `the token is never stored, only what it hashes to`() {
        val token = newInviteToken()
        val other = newInviteToken()

        assertEquals(hashInviteToken(token), hashInviteToken(token))
        assertFalse(hashInviteToken(token) == hashInviteToken(other))
        // A dump of account_invite grants nobody anything, which is the only reason the preview
        // behind a token can be unauthenticated.
        assertFalse(hashInviteToken(token).contains(token))
    }

    // Helpers. Each writes the sender's side of one fact, so the tests above read as the claim
    // they make rather than as setup.

    private fun addCharacter(
        userId: String,
        name: String,
        position: Int,
    ): Uuid {
        ensureUser(userId, "$userId@example.com")
        val id = Uuid.random()
        val now = Clock.System.now()
        Characters.insert {
            it[Characters.id] = id
            it[Characters.userId] = userId
            it[Characters.name] = name
            it[createdAt] = now
            it[updatedAt] = now
            it[Characters.position] = position
        }
        return id
    }

    /** Says whose a character is, keeping every person already named. */
    private fun attribute(
        person: String,
        character: String,
    ) {
        val existing =
            peopleOf(senderId).map { (name, characters) ->
                PersonRequest(
                    id = personRow(senderId, name)[Person.id].toString(),
                    name = name,
                    characters = characters,
                )
            }
        savePeople(
            senderId,
            SavePeopleRequest(existing + PersonRequest(name = person, characters = listOf(character))),
            Clock.System.now(),
        )
    }

    private fun config(
        characterId: Uuid,
        bossKey: String,
        members: List<String>,
    ): Uuid =
        createParty(
            userId = senderId,
            characterId = characterId,
            bossCatalogId = bossIdForKey(bossKey)!!,
            request = SavePartyRequest(characterId.toString(), bossKey, members),
            now = Clock.System.now(),
        )

    private fun solo(
        characterId: Uuid,
        bossKey: String,
    ) {
        val id = config(characterId, bossKey, emptyList())
        Party.update({ Party.id eq id }) { it[Party.solo] = true }
    }

    private fun payloadFor(person: String): InvitePayload =
        buildInvitePayload(senderId, personRow(senderId, person)[Person.id], senderName = "Jonathan")!!

    /**
     * Makes a link for [person] and redeems it into an empty account.
     *
     * The person is named again rather than read out of the payload: the payload does not carry
     * the recipient, only what they are being given, and taking the first name in it would accept
     * one person's link on behalf of another.
     */
    private fun invite(
        person: String,
        into: String = recipientId,
    ): AcceptedInvite {
        ensureUser(into, "$into@example.com")
        assertTrue(accountIsEmpty(into), "the test's recipient account is not empty")
        val personId = personRow(senderId, person)[Person.id]
        return acceptInvite(buildInvitePayload(senderId, personId, "Jonathan")!!, into, personId, Clock.System.now())
    }

    private fun accept(
        payload: InvitePayload,
        person: String,
        into: String = recipientId,
    ): AcceptedInvite {
        ensureUser(into, "$into@example.com")
        return acceptInvite(payload, into, personRow(senderId, person)[Person.id], Clock.System.now())
    }

    private fun personRow(
        userId: String,
        name: String,
    ) = Person
        .selectAll()
        .where { (Person.userId eq userId) and (Person.name eq name) }
        .single()

    private fun peopleOf(userId: String): Map<String, List<String>> {
        val characters =
            PersonCharacter
                .selectAll()
                .where { PersonCharacter.userId eq userId }
                .orderBy(PersonCharacter.name)
                .groupBy({ it[PersonCharacter.personId] }) { it[PersonCharacter.name] }
        return Person
            .selectAll()
            .where { Person.userId eq userId }
            .associate { it[Person.name] to characters[it[Person.id]].orEmpty() }
    }

    private fun charactersOf(userId: String): Map<String, Uuid> =
        Characters
            .selectAll()
            .where { Characters.userId eq userId }
            .associate { it[Characters.name].lowercase() to it[Characters.id] }

    private fun partiesOf(userId: String) =
        Party
            .selectAll()
            .where { Party.userId eq userId }
            .toList()

    private fun partyRow(partyId: Uuid) = Party.selectAll().where { Party.id eq partyId }.single()

    private fun seatNamesOf(partyId: Uuid): List<String> =
        PartyMember
            .selectAll()
            .where { PartyMember.partyId eq partyId }
            .orderBy(PartyMember.position)
            .map { it[PartyMember.name] }

    private fun seatFor(
        partyId: Uuid,
        name: String,
    ) = PartyMember
        .selectAll()
        .where { (PartyMember.partyId eq partyId) and (PartyMember.name eq name) }
        .single()

    private fun nameOf(
        id: Uuid,
        seat: Boolean = false,
    ): String =
        if (seat) {
            PartyMember.selectAll().where { PartyMember.id eq id }.single()[PartyMember.name]
        } else {
            Characters.selectAll().where { Characters.id eq id }.single()[Characters.name]
        }
}
