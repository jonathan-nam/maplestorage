package com.maplestorage.backend.bosses

import com.maplestorage.backend.config.Env
import com.maplestorage.backend.db.BossCatalog
import com.maplestorage.backend.db.BossClear
import com.maplestorage.backend.db.CharacterBossSkip
import com.maplestorage.backend.db.Characters
import com.maplestorage.backend.db.Party
import com.maplestorage.backend.db.Screenshots
import com.maplestorage.backend.parties.SavePartyRequest
import com.maplestorage.backend.parties.createParty
import com.maplestorage.backend.services.DetectedBossClear
import com.maplestorage.backend.users.ensureUser
import org.flywaydb.core.Flyway
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
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.time.Clock
import kotlin.time.Instant
import kotlin.uuid.Uuid

/**
 * Which bosses a character runs, against a real Postgres.
 *
 * The routine exists to keep two absences apart, so what is worth testing is the rules that stop it
 * becoming a third kind of wrong answer: that it outlives a reset (or it is no better than the
 * pending row it replaces), that a save replaces the set rather than merging into it, and that
 * nothing rewrites it on the user's behalf.
 */
class BossRoutineTest {
    private val userOneId = "user_test_routine_1"
    private val userTwoId = "user_test_routine_2"

    // A Thursday (GMS weekly reset), the Saturday inside that week, and the Thursday after it.
    // Verified against the calendar, not assumed. See BossPeriodTest.
    private val midWeek = Instant.parse("2026-07-18T12:00:00Z")
    private val nextWeek = Instant.parse("2026-07-23T12:00:00Z")

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
            val ids =
                Characters
                    .selectAll()
                    .where { (Characters.userId eq userOneId) or (Characters.userId eq userTwoId) }
                    .map { it[Characters.id] }
            // Everything that references a character goes before the character does. party_member
            // cascades off party, so deleting the config is enough for the seats.
            ids.forEach { id -> BossClear.deleteWhere { characterId eq id } }
            ids.forEach { id -> CharacterBossSkip.deleteWhere { characterId eq id } }
            Party.deleteWhere { (Party.userId eq userOneId) or (Party.userId eq userTwoId) }
            Screenshots.deleteWhere { (Screenshots.userId eq userOneId) or (Screenshots.userId eq userTwoId) }
            Characters.deleteWhere { (Characters.userId eq userOneId) or (Characters.userId eq userTwoId) }
        }
    }

    private fun addCharacter(
        userId: String,
        name: String,
    ): Uuid {
        ensureUser(userId, "$userId@example.com")
        val id = Uuid.random()
        val now = Clock.System.now()
        val nextPosition =
            Characters
                .selectAll()
                .where { Characters.userId eq userId }
                .count()
                .toInt()
        Characters.insert {
            it[Characters.id] = id
            it[Characters.userId] = userId
            it[Characters.name] = name
            it[createdAt] = now
            it[updatedAt] = now
            it[position] = nextPosition
        }
        return id
    }

    private fun addScreenshot(userId: String): Uuid {
        val id = Uuid.random()
        Screenshots.insert {
            it[Screenshots.id] = id
            it[Screenshots.userId] = userId
            it[uploadedAt] = Clock.System.now()
            it[parseStatus] = "SUCCESS"
            it[type] = "PLANNER"
        }
        return id
    }

    private fun bossId(bossKey: String): Uuid =
        BossCatalog.selectAll().where { BossCatalog.bossKey eq bossKey }.single()[BossCatalog.id]

    private fun skipsOf(
        userId: String,
        character: Uuid,
    ): List<String> = bossSkipsFor(userId)[character.toString()].orEmpty()

    @Test
    fun `a routine outlives the reset that wipes the clears`() =
        transaction {
            // The whole reason it is not a boss_clear row. "Only my main runs Jupiter" said once a
            // week is said never, so a routine that expired with the period would be no better than
            // the dash it replaces.
            val character = addCharacter(userOneId, "Standing")
            assertNull(setBossRoutine(userOneId, character, listOf("jupiter"), midWeek))

            assertEquals(listOf("jupiter"), skipsOf(userOneId, character))
            assertTrue(currentBossClearsFor(userOneId, nextWeek)[character.toString()].isNullOrEmpty())
        }

    @Test
    fun `a save replaces the set rather than adding to it`() =
        transaction {
            // The editor sends the whole checklist, so a boss it did not send is one this character
            // now runs. Merging instead would make a box impossible to un-tick.
            val character = addCharacter(userOneId, "Replaced")
            setBossRoutine(userOneId, character, listOf("jupiter", "limbo"), midWeek)
            setBossRoutine(userOneId, character, listOf("limbo"), midWeek)

            assertEquals(listOf("limbo"), skipsOf(userOneId, character))
        }

    @Test
    fun `an empty save says this character runs everything`() =
        transaction {
            val character = addCharacter(userOneId, "Emptied")
            setBossRoutine(userOneId, character, listOf("jupiter"), midWeek)
            setBossRoutine(userOneId, character, emptyList(), midWeek)

            assertEquals(emptyList(), skipsOf(userOneId, character))
        }

    @Test
    fun `a routine leaves the capture's own rows alone`() =
        transaction {
            // The routine sits over the planner's answer rather than replacing it, so un-ticking
            // restores what the capture actually said instead of a blank.
            val character = addCharacter(userOneId, "Restored")
            upsertBossClears(
                character,
                listOf(DetectedBossClear("jupiter", false)),
                addScreenshot(userOneId),
                midWeek,
            )
            setBossRoutine(userOneId, character, listOf("jupiter"), midWeek)
            setBossRoutine(userOneId, character, emptyList(), midWeek)

            val clears = currentBossClearsFor(userOneId, midWeek).getValue(character.toString())
            assertEquals(listOf("jupiter"), clears.map { it.bossKey })
            assertFalse(clears.single().cleared)
        }

    @Test
    fun `a one-off clear does not rewrite the routine`() =
        transaction {
            // Ran it once this week, but it is still not what this character does. The matrix draws
            // the tick (a clear outranks the mark, see lib/boss-clears.ts) and the routine stands,
            // so next period the cell is back to "doesn't run". Dropping the mark here would be
            // this app editing a standing statement on the strength of one week.
            val character = addCharacter(userOneId, "OneOff")
            setBossRoutine(userOneId, character, listOf("jupiter"), midWeek)

            setBossClearByHand(userOneId, character, "jupiter", true, midWeek)
            upsertBossClears(
                character,
                listOf(DetectedBossClear("jupiter", true)),
                addScreenshot(userOneId),
                midWeek,
            )

            assertEquals(listOf("jupiter"), skipsOf(userOneId, character))
        }

    @Test
    fun `refuses a routine that unticks a boss the character has a party for`() =
        transaction {
            // A config is (character, boss, difficulty, who with), which is the same claim in more
            // detail. The two cannot both be true, and the config is the one that says more. The
            // editor locks these, so reaching this means the two got out of step.
            val character = addCharacter(userOneId, "Partied")
            Party.insert {
                it[id] = Uuid.random()
                it[userId] = userOneId
                it[characterId] = character
                it[bossCatalogId] = bossId("jupiter")
                it[createdAt] = midWeek
                it[updatedAt] = midWeek
            }

            val refusal = setBossRoutine(userOneId, character, listOf("jupiter"), midWeek)

            assertIs<RoutineRefusal.HasParty>(refusal)
            assertEquals(listOf("Jupiter"), refusal.bossNames)
            assertEquals(emptyList(), skipsOf(userOneId, character))
        }

    @Test
    fun `a refused save writes nothing at all, not even the part that was fine`() =
        transaction {
            // Half-applying would leave the page showing a routine nobody described.
            val character = addCharacter(userOneId, "Partial")
            Party.insert {
                it[id] = Uuid.random()
                it[userId] = userOneId
                it[characterId] = character
                it[bossCatalogId] = bossId("jupiter")
                it[createdAt] = midWeek
                it[updatedAt] = midWeek
            }

            setBossRoutine(userOneId, character, listOf("limbo", "jupiter"), midWeek)

            assertEquals(emptyList(), skipsOf(userOneId, character))
        }

    @Test
    fun `making a party for a boss the character does not run takes the mark back`() =
        transaction {
            // The other order of the same contradiction. The routine save refuses, so this one has
            // to resolve it, or a config and a "doesn't run" would sit side by side saying the
            // opposite of each other.
            val character = addCharacter(userOneId, "Recruited")
            setBossRoutine(userOneId, character, listOf("jupiter"), midWeek)

            createParty(
                userOneId,
                character,
                bossId("jupiter"),
                SavePartyRequest(characterId = character.toString(), bossKey = "jupiter"),
                midWeek,
            )

            assertEquals(emptyList(), skipsOf(userOneId, character))
        }

    @Test
    fun `refuses a character that is not this user's, and a boss nobody named`() =
        transaction {
            val mine = addCharacter(userOneId, "Mine")
            val theirs = addCharacter(userTwoId, "Theirs")

            assertEquals(RoutineRefusal.Unknown, setBossRoutine(userOneId, theirs, listOf("jupiter"), midWeek))
            assertEquals(RoutineRefusal.Unknown, setBossRoutine(userOneId, mine, listOf("not-a-boss"), midWeek))
            // Refused whole: the real key alongside it is not saved either.
            assertEquals(
                RoutineRefusal.Unknown,
                setBossRoutine(userOneId, mine, listOf("jupiter", "not-a-boss"), midWeek),
            )
            assertEquals(emptyList(), skipsOf(userOneId, mine))
            assertEquals(emptyList(), skipsOf(userTwoId, theirs))
        }

    @Test
    fun `one user's routine stays out of another's matrix`() =
        transaction {
            val mine = addCharacter(userOneId, "Mine")
            val theirs = addCharacter(userTwoId, "Theirs")
            setBossRoutine(userOneId, mine, listOf("jupiter"), midWeek)
            setBossRoutine(userTwoId, theirs, listOf("lotus"), midWeek)

            assertEquals(mapOf(mine.toString() to listOf("jupiter")), bossSkipsFor(userOneId))
            assertEquals(mapOf(theirs.toString() to listOf("lotus")), bossSkipsFor(userTwoId))
        }

    @Test
    fun `saving the same routine twice is one row per boss, not two`() =
        transaction {
            val character = addCharacter(userOneId, "Twice")
            setBossRoutine(userOneId, character, listOf("jupiter"), midWeek)
            setBossRoutine(userOneId, character, listOf("jupiter"), nextWeek)

            assertEquals(listOf("jupiter"), skipsOf(userOneId, character))
        }

    @Test
    fun `one character's routine says nothing about another's`() =
        transaction {
            // The replace is scoped to the character being saved. Without that, setting up your
            // second character would wipe what you said about your first.
            val main = addCharacter(userOneId, "Main")
            val alt = addCharacter(userOneId, "Alt")
            setBossRoutine(userOneId, alt, listOf("jupiter"), midWeek)
            setBossRoutine(userOneId, main, listOf("limbo"), midWeek)

            assertEquals(listOf("jupiter"), skipsOf(userOneId, alt))
            assertEquals(listOf("limbo"), skipsOf(userOneId, main))
        }
}
