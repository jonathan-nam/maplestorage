package com.maplestorage.backend.share

import com.maplestorage.backend.config.Env
import com.maplestorage.backend.db.Characters
import com.maplestorage.backend.db.Party
import com.maplestorage.backend.db.PartyMember
import com.maplestorage.backend.db.Person
import com.maplestorage.backend.parties.PersonRequest
import com.maplestorage.backend.parties.SavePartyRequest
import com.maplestorage.backend.parties.SavePeopleRequest
import com.maplestorage.backend.parties.bossIdForKey
import com.maplestorage.backend.parties.createParty
import com.maplestorage.backend.parties.createSoloParty
import com.maplestorage.backend.parties.savePeople
import com.maplestorage.backend.users.ensureUser
import org.flywaydb.core.Flyway
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.jdbc.Database
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import org.jetbrains.exposed.v1.jdbc.update
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.time.Clock
import kotlin.uuid.Uuid

/**
 * What an account hands over, against a real Postgres.
 *
 * The claims worth a database to check are all about what does NOT cross. An export that quietly
 * carried a retired config, a guest seat or a pool would put a record into an account that was
 * never party to it, and every one of those reads as an arrangement somebody agreed to.
 */
class ConfigExportTest {
    private val userId = "user_test_export_1"

    @BeforeTest
    fun migrate() {
        val jdbcUrl = "jdbc:postgresql://${Env.dbHost}:${Env.dbPort}/${Env.dbName}"
        Flyway
            .configure()
            .dataSource(jdbcUrl, Env.dbUsername, Env.dbPassword)
            .load()
            .migrate()
        Database.connect(jdbcUrl, "org.postgresql.Driver", Env.dbUsername, Env.dbPassword)
    }

    @AfterTest
    fun cleanUp() {
        transaction {
            Party.deleteWhere { Party.userId eq this@ConfigExportTest.userId }
            Person.deleteWhere { Person.userId eq this@ConfigExportTest.userId }
            Characters.deleteWhere { Characters.userId eq this@ConfigExportTest.userId }
        }
    }

    private fun addCharacter(name: String): Uuid {
        ensureUser(userId, "$userId@example.com")
        val id = Uuid.random()
        val now = Clock.System.now()
        Characters.insert {
            it[Characters.id] = id
            it[Characters.userId] = this@ConfigExportTest.userId
            it[Characters.name] = name
            it[createdAt] = now
            it[updatedAt] = now
            it[position] = 0
        }
        return id
    }

    private fun config(
        characterId: Uuid,
        bossKey: String,
        members: List<String>,
        difficulty: String? = null,
        minutes: Int? = null,
        shares: Map<String, Int> = emptyMap(),
    ): Uuid =
        createParty(
            userId,
            characterId,
            bossIdForKey(bossKey)!!,
            SavePartyRequest(characterId.toString(), bossKey, members, shares, difficulty, minutes),
            Clock.System.now(),
        )

    @Test
    fun `a config carries its whole roster, the anchor included, with what each seat takes`() {
        transaction {
            val mine = addCharacter("mechyfechy")
            config(mine, "kalos-the-guardian", listOf("CreedBratton"), "EXTREME", 30, mapOf("CreedBratton" to 2))

            val document = buildExport(userId, "Jonathan").document
            val kalos = document.configs.single()

            assertEquals("mechyfechy", kalos.anchor)
            assertEquals("EXTREME", kalos.difficulty)
            assertEquals(30, kalos.minutes)
            // The anchor is a seat of its own roster, which is what makes the reader's pivot a
            // change of one field rather than a rebuild of the party.
            assertEquals(listOf("mechyfechy", "CreedBratton"), kalos.seats.map { it.name })
            assertEquals(listOf(1, 2), kalos.seats.map { it.shares })
        }
    }

    @Test
    fun `the author is in the people list, flagged, with their own characters`() {
        transaction {
            addCharacter("mechyfechy")
            addCharacter("warrior2020")
            savePeople(
                userId,
                SavePeopleRequest(listOf(PersonRequest(name = "Bro", characters = listOf("CreedBratton")))),
                Clock.System.now(),
            )

            val people = buildExport(userId, "Jonathan").document.people

            // Everybody in one list, so the reader's question is "which of these is you?" and both
            // halves of the swap fall out of the answer.
            assertEquals(listOf("Bro", "Jonathan"), people.map { it.name })
            assertEquals(listOf("CreedBratton"), people[0].characters)
            assertTrue(people[1].author)
            assertEquals(listOf("mechyfechy", "warrior2020"), people[1].characters)
        }
    }

    @Test
    fun `a retired config is left out and counted, because a pool cannot cross`() {
        transaction {
            val mine = addCharacter("mechyfechy")
            val party = config(mine, "baldrix", listOf("CreedBratton"))
            Party.update({ Party.id eq party }) { it[standing] = false }

            val export = buildExport(userId, "Jonathan")

            assertTrue(export.document.configs.isEmpty())
            assertEquals(1, export.omitted.retiredConfigs)
        }
    }

    @Test
    fun `a solo config is left out and counted, having nobody else in it`() {
        transaction {
            val mine = addCharacter("mechyfechy")
            createSoloParty(userId, mine, bossIdForKey("lucid")!!, Clock.System.now())

            val export = buildExport(userId, "Jonathan")

            assertTrue(export.document.configs.isEmpty())
            assertEquals(1, export.omitted.soloConfigs)
        }
    }

    @Test
    fun `a one-off is left out and counted, being a night rather than an arrangement`() {
        transaction {
            val mine = addCharacter("mechyfechy")
            val party = config(mine, "kaling", listOf("CreedBratton"))
            Party.update({ Party.id eq party }) { it[oneOff] = true }

            val export = buildExport(userId, "Jonathan")

            assertTrue(export.document.configs.isEmpty())
            assertEquals(1, export.omitted.oneOffConfigs)
        }
    }

    @Test
    fun `a guest seat is left out and counted, saying who ran a week rather than who is in the party`() {
        transaction {
            val mine = addCharacter("mechyfechy")
            val party = config(mine, "limbo", listOf("CreedBratton", "Freeballynn"))
            // What retiring a seat does: it stays, because payouts point at it, and stops being
            // part of the usual roster. See V27__party_week_roster.sql.
            PartyMember.update({ (PartyMember.partyId eq party) and (PartyMember.name eq "Freeballynn") }) {
                it[standing] = false
            }

            val export = buildExport(userId, "Jonathan")

            assertEquals(
                listOf("mechyfechy", "CreedBratton"),
                export.document.configs
                    .single()
                    .seats
                    .map { it.name },
            )
            assertEquals(1, export.omitted.guestSeats)
        }
    }

    @Test
    fun `a name already on the people list cannot be exported under`() {
        transaction {
            addCharacter("mechyfechy")
            savePeople(
                userId,
                SavePeopleRequest(listOf(PersonRequest(name = "Bro", characters = listOf("CreedBratton")))),
                Clock.System.now(),
            )

            // Two people the reader cannot tell apart is the same mistake V21's unique index
            // refuses one account inside, arriving through a file instead.
            assertNotNull(validateExport(userId, "bro"))
            assertNotNull(validateExport(userId, "  "))
            assertNull(validateExport(userId, "Jonathan"))
        }
    }

    @Test
    fun `a character in two configs for one boss is refused rather than handed over`() {
        // The rule validateBossRoster enforces on every write since #213, checked again at the
        // point the pair would leave this account: a character clears a boss once a period, and a
        // reader has no way to know which of the two is the real one.
        val document =
            documentOf(
                ShareConfig("mechyfechy", "kalos-the-guardian", seats = seats("mechyfechy", "Freeballynn")),
                ShareConfig("warrior2020", "kalos-the-guardian", seats = seats("warrior2020", "freeballynn")),
            )

        val refusal = assertNotNull(validateDocument(document))
        assertTrue(refusal.contains("freeballynn", ignoreCase = true))
        assertTrue(refusal.contains("kalos-the-guardian"))
    }

    @Test
    fun `the same character in two configs for DIFFERENT bosses is ordinary`() {
        val document =
            documentOf(
                ShareConfig("mechyfechy", "kalos-the-guardian", seats = seats("mechyfechy", "Freeballynn")),
                ShareConfig("mechyfechy", "limbo", seats = seats("mechyfechy", "Freeballynn")),
            )

        assertNull(validateDocument(document))
    }

    private fun seats(vararg names: String) = names.map { ShareSeat(it) }

    private fun documentOf(vararg configs: ShareConfig) =
        ShareDocument(
            exportedAt = "2026-08-08T00:00:00Z",
            author = "Jonathan",
            worldType = "INTERACTIVE",
            people = emptyList(),
            configs = configs.toList(),
        )
}
