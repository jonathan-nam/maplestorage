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
import com.sharpeyes.backend.parties.partiesSeatedIn
import com.sharpeyes.backend.parties.savePeople
import com.sharpeyes.backend.users.WORLD_HEROIC
import com.sharpeyes.backend.users.WORLD_INTERACTIVE
import com.sharpeyes.backend.users.activeWorldFor
import com.sharpeyes.backend.users.ensureUser
import com.sharpeyes.backend.users.setActiveWorld
import org.flywaydb.core.Flyway
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.or
import org.jetbrains.exposed.v1.jdbc.Database
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.time.Clock
import kotlin.uuid.Uuid

/**
 * A link for somebody the sender has no record of, against a real Postgres.
 *
 * The claim under test is that one character each way is enough. The sender types nothing, knows
 * nobody, and what comes back is two accounts that can seat each other: the seats they had already
 * typed bind at once, and the ones they type afterwards bind on their own, because a linked ACCOUNT
 * is what a seat is matched against and not a list of characters somebody copied over.
 *
 * The other half is what must NOT happen. A stranger's link creates no config on either side, and
 * it is refused outright where the sender already knows the name, which is the one case where
 * binding would hand somebody else's parties to whoever holds the URL.
 */
class OpenInviteTest {
    private val senderId = "user_test_open_sender"
    private val joinerId = "user_test_open_joiner"

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
                    .where { (Characters.userId eq senderId) or (Characters.userId eq joinerId) }
                    .map { it[Characters.id] }
            owned.forEach { id -> BossClear.deleteWhere { characterId eq id } }
            AccountInvite.deleteWhere {
                (AccountInvite.userId eq senderId) or (AccountInvite.userId eq joinerId)
            }
            Party.deleteWhere { (Party.userId eq senderId) or (Party.userId eq joinerId) }
            Person.deleteWhere { (Person.userId eq senderId) or (Person.userId eq joinerId) }
            Characters.deleteWhere {
                (Characters.userId eq senderId) or (Characters.userId eq joinerId)
            }
        }
    }

    @Test
    fun `a stranger's link binds the seat their character was already sitting in`() {
        transaction {
            val mine = addCharacter(senderId, "mechyfechy")
            // Typed into a roster and attributed to nobody, which is what a party looks like before
            // anyone has been invited to anything.
            val party = config(mine, "kalos-the-guardian", listOf("CreedBratton"))

            val taken = join("CreedBratton")

            assertEquals(1, taken.partiesCreated)
            val theirs = characterOf(joinerId, "CreedBratton")
            assertEquals(theirs, seatFor(party, "CreedBratton")[PartyMember.linkedCharacterId])
            // Which is the whole of their membership: the party is still the sender's one row.
            assertEquals(emptyList(), partiesOf(joinerId))
            assertEquals(listOf(party.toString()), partiesSeatedIn(joinerId).map { it.id })
        }
    }

    @Test
    fun `each side ends up with a person for the other, and knows it is an account`() {
        transaction {
            addCharacter(senderId, "mechyfechy")

            join("CreedBratton")

            // Named after the one character each of them gave. Nobody else's name travels, because
            // a stranger's link has nobody else's to carry.
            assertEquals(mapOf("CreedBratton" to listOf("CreedBratton")), peopleOf(senderId))
            assertEquals(mapOf("mechyfechy" to listOf("mechyfechy")), peopleOf(joinerId))

            assertEquals(joinerId, personRow(senderId, "CreedBratton")[Person.linkedUserId])
            assertEquals(senderId, personRow(joinerId, "mechyfechy")[Person.linkedUserId])
        }
    }

    @Test
    fun `one character is enough, so a seat typed afterwards binds on its own`() {
        transaction {
            val mine = addCharacter(senderId, "mechyfechy")

            // No party at all when they are introduced, which is the ordinary case: you swap the
            // link, and the config is made later.
            assertEquals(0, join("CreedBratton").partiesCreated)

            val party = config(mine, "kalos-the-guardian", listOf("CreedBratton"))

            // Nothing bound it. The seat writer reads the linked ACCOUNT's characters, so the one
            // name the link carried is all the sender ever needed. See linkedCharactersFor.
            assertEquals(
                characterOf(joinerId, "CreedBratton"),
                seatFor(party, "CreedBratton")[PartyMember.linkedCharacterId],
            )
            assertEquals(listOf(party.toString()), partiesSeatedIn(joinerId).map { it.id })
        }
    }

    @Test
    fun `a name the sender already knows is refused rather than bound`() {
        transaction {
            addCharacter(senderId, "mechyfechy")
            attribute("Bro", "CreedBratton")
            ensureUser(joinerId, "$joinerId@example.com")

            // Either they are not strangers, or somebody is claiming a character that is not
            // theirs. The refusal is the same, and it points at the link that IS addressed to Bro.
            val refusal = openInviteRefusal(link(), joinerId, "CreedBratton")
            assertNotNull(refusal)
            assertTrue(refusal.contains("already knows"), refusal)

            // Their own character too, which is the same claim made about the sender themselves.
            assertNotNull(openInviteRefusal(link(), joinerId, "mechyfechy"))
        }
    }

    @Test
    fun `an unattributed seat is not the sender knowing them`() {
        transaction {
            val mine = addCharacter(senderId, "mechyfechy")
            config(mine, "kalos-the-guardian", listOf("CreedBratton"))
            ensureUser(joinerId, "$joinerId@example.com")

            // The case the link exists for: a roster typed from memory, with nobody attached to
            // any of it. Refusing on a bare seat name would refuse everybody you actually run with.
            assertNull(openInviteRefusal(link(), joinerId, "CreedBratton"))
        }
    }

    @Test
    fun `a character in the other world is refused, not given a second row`() {
        transaction {
            addCharacter(senderId, "mechyfechy")
            addCharacter(joinerId, "CreedBratton", world = WORLD_HEROIC)

            // Names are unique within a world and not across them, so this is a different character
            // that cannot party with the sender at all.
            val refusal = openInviteRefusal(link(), joinerId, "CreedBratton")
            assertNotNull(refusal)
            assertTrue(refusal.contains("other world"), refusal)
        }
    }

    @Test
    fun `naming nobody is refused`() {
        transaction {
            addCharacter(senderId, "mechyfechy")
            ensureUser(joinerId, "$joinerId@example.com")

            assertNotNull(openInviteRefusal(link(), joinerId, null))
            assertNotNull(openInviteRefusal(link(), joinerId, "   "))
        }
    }

    @Test
    fun `a character the joiner already has is bound, not duplicated`() {
        transaction {
            val mine = addCharacter(senderId, "mechyfechy")
            val theirs = addCharacter(joinerId, "CreedBratton")
            val party = config(mine, "kalos-the-guardian", listOf("CreedBratton"))

            join("CreedBratton")

            assertEquals(listOf(theirs), charactersOf(joinerId).values.toList())
            assertEquals(theirs, seatFor(party, "CreedBratton")[PartyMember.linkedCharacterId])
        }
    }

    @Test
    fun `an account that has never chosen a world takes the link's`() {
        transaction {
            addCharacter(senderId, "mechyfechy")

            join("CreedBratton")

            // Which is what makes the party visible to them at all: every account-wide read is
            // narrowed by it, and V74 leaves it unanswered until something answers it.
            assertEquals(WORLD_INTERACTIVE, activeWorldFor(joinerId))
        }
    }

    @Test
    fun `a link naming nobody still reads back, and names nobody`() {
        transaction {
            addCharacter(senderId, "mechyfechy")

            val made = makeOpenLink(senderId, "token-one", Clock.System.now())

            // The read is a LEFT join, because there is no person row to join to. An inner one
            // answers that the invite does not exist, which is a 500 on the press that made it.
            val invite = assertIs<OpenLink.Made>(made).invite
            assertNull(invite.personId)
            assertNull(invite.personName)
            assertEquals("mechyfechy", invite.senderName)
            assertEquals("token-one", invite.token)
            // Nothing to hand over, said as nothing rather than as a wrong count.
            assertEquals(0, invite.characterCount)
            assertEquals(0, invite.partyCount)
        }
    }

    @Test
    fun `making another link replaces the one before it`() {
        transaction {
            addCharacter(senderId, "mechyfechy")

            makeOpenLink(senderId, "token-one", Clock.System.now())
            makeOpenLink(senderId, "token-two", Clock.System.now())

            // One live link per account, which is what pressing the button again means. The first
            // token stops working at the same moment, and the landing page says so.
            assertNull(invitePreviewFor("token-one"))
            assertNotNull(invitePreviewFor("token-two"))
        }
    }

    @Test
    fun `an account with no character has no name to send a link under`() {
        transaction {
            ensureUser(senderId, "$senderId@example.com")

            // Every person on this app is named after a character, the sender included, so there is
            // nothing to put on the recipient's people board. Refused rather than sent as an id.
            assertIs<OpenLink.No>(makeOpenLink(senderId, "token-one", Clock.System.now()))
        }
    }

    @Test
    fun `the landing page is told which question to ask`() {
        transaction {
            addCharacter(senderId, "mechyfechy")
            makeOpenLink(senderId, "token-one", Clock.System.now())

            val preview = assertNotNull(invitePreviewFor("token-one"))
            assertTrue(preview.open)
            assertEquals("mechyfechy", preview.senderName)
            // Nothing of anybody's to show, which is why the page asks instead of offering.
            assertEquals(emptyList(), preview.characters)
            assertEquals(emptyList(), preview.parties)
            // The sender, who is the one person this link does hand over.
            assertEquals(1, preview.peopleCount)
        }
    }

    // Helpers. Each writes one side of one fact, so the tests above read as the claim they make.

    /** The link the sender's account would make, which is the row's payload. */
    private fun link(senderName: String = "mechyfechy"): InvitePayload =
        openPayload(senderId, senderName, WORLD_INTERACTIVE)

    /** Redeems an open link into the joiner's account, as the character they name. */
    private fun join(
        character: String,
        senderName: String = "mechyfechy",
    ): AcceptedInvite {
        ensureUser(joinerId, "$joinerId@example.com")
        val payload = link(senderName)
        assertNull(openInviteRefusal(payload, joinerId, character))
        return acceptOpenInvite(payload, joinerId, character, Clock.System.now())
    }

    private fun addCharacter(
        userId: String,
        name: String,
        world: String = WORLD_INTERACTIVE,
    ): Uuid {
        ensureUser(userId, "$userId@example.com")
        // Inserted here rather than through the route, so the account has to say which world it is
        // looking at. The JOINER is given one only where a test is about having one already:
        // adopting the link's is behaviour these tests hold, so it must not be set out from under
        // them. See V74.
        setActiveWorld(userId, world)
        val id = Uuid.random()
        val now = Clock.System.now()
        Characters.insert {
            it[Characters.id] = id
            it[Characters.userId] = userId
            it[Characters.name] = name
            it[worldType] = world
            it[createdAt] = now
            it[updatedAt] = now
            it[position] = 0
        }
        return id
    }

    private fun attribute(
        person: String,
        character: String,
    ) = savePeople(
        senderId,
        SavePeopleRequest(listOf(PersonRequest(name = person, characters = listOf(character)))),
        Clock.System.now(),
    )

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

    private fun characterOf(
        userId: String,
        name: String,
    ): Uuid = charactersOf(userId).getValue(name.lowercase())

    private fun partiesOf(userId: String) =
        Party
            .selectAll()
            .where { Party.userId eq userId }
            .toList()

    private fun seatFor(
        partyId: Uuid,
        name: String,
    ) = PartyMember
        .selectAll()
        .where { (PartyMember.partyId eq partyId) and (PartyMember.name eq name) }
        .single()
}
