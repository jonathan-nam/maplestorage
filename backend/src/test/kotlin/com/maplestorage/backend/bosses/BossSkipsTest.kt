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
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.time.Clock
import kotlin.time.Instant
import kotlin.uuid.Uuid

/**
 * "Doesn't run" against a real Postgres.
 *
 * The mark exists to keep two absences apart, so what is worth testing is the rules that stop it
 * becoming a third kind of wrong answer: that it outlives a reset (or it is no better than the
 * pending row it replaces), that a clear always beats it, and that it can never be written on top
 * of a fact that contradicts it.
 */
class BossSkipsTest {
    private val userOneId = "user_test_skips_1"
    private val userTwoId = "user_test_skips_2"

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
    fun `a mark outlives the reset that wipes the clears`() =
        transaction {
            // The whole reason it is not a boss_clear row. "Only my main runs Jupiter" said once a
            // week is said never, so a mark that expired with the period would be no better than
            // the dash it replaces.
            val character = addCharacter(userOneId, "Standing")
            assertNull(setBossSkip(userOneId, character, "jupiter", true, midWeek))

            assertEquals(listOf("jupiter"), skipsOf(userOneId, character))
            // Read from a later period: nothing about the mark is keyed on one.
            assertEquals(listOf("jupiter"), skipsOf(userOneId, character))
            assertTrue(currentBossClearsFor(userOneId, nextWeek)[character.toString()].isNullOrEmpty())
        }

    @Test
    fun `unmarking leaves the capture's own row alone`() =
        transaction {
            // The mark sits over the planner's answer rather than replacing it, so taking it back
            // restores what the capture actually said instead of a blank.
            val character = addCharacter(userOneId, "Restored")
            upsertBossClears(
                character,
                listOf(DetectedBossClear("jupiter", false)),
                addScreenshot(userOneId),
                midWeek,
            )
            setBossSkip(userOneId, character, "jupiter", true, midWeek)
            setBossSkip(userOneId, character, "jupiter", false, midWeek)

            assertEquals(emptyList(), skipsOf(userOneId, character))
            val clears = currentBossClearsFor(userOneId, midWeek).getValue(character.toString())
            assertEquals(listOf("jupiter"), clears.map { it.bossKey })
            assertFalse(clears.single().cleared)
        }

    @Test
    fun `a hand-ticked clear drops the mark, because a clear is proof it was run`() =
        transaction {
            val character = addCharacter(userOneId, "Ticked")
            setBossSkip(userOneId, character, "jupiter", true, midWeek)

            assertTrue(setBossClearByHand(userOneId, character, "jupiter", true, midWeek))

            assertEquals(emptyList(), skipsOf(userOneId, character))
        }

    @Test
    fun `a captured clear drops the mark too`() =
        transaction {
            val character = addCharacter(userOneId, "Captured")
            setBossSkip(userOneId, character, "jupiter", true, midWeek)
            upsertBossClears(
                character,
                listOf(DetectedBossClear("jupiter", true)),
                addScreenshot(userOneId),
                midWeek,
            )

            assertEquals(emptyList(), skipsOf(userOneId, character))
        }

    @Test
    fun `a capture that only lists the boss leaves the mark standing`() =
        transaction {
            // A planner still listing a boss says nothing about whether it gets run: the row lives
            // there until somebody removes it. Only a clear is evidence, so only a clear wins.
            val character = addCharacter(userOneId, "Listed")
            setBossSkip(userOneId, character, "jupiter", true, midWeek)
            upsertBossClears(
                character,
                listOf(DetectedBossClear("jupiter", false)),
                addScreenshot(userOneId),
                midWeek,
            )

            assertEquals(listOf("jupiter"), skipsOf(userOneId, character))
        }

    @Test
    fun `refuses a mark on a boss already cleared this period`() =
        transaction {
            // Allowed, it would store a row the matrix then has to overrule in order to draw the
            // clear, so the click would look like it did nothing at all.
            val character = addCharacter(userOneId, "Cleared")
            setBossClearByHand(userOneId, character, "jupiter", true, midWeek)

            assertEquals(SkipRefusal.HAS_CLEAR, setBossSkip(userOneId, character, "jupiter", true, midWeek))
            assertEquals(emptyList(), skipsOf(userOneId, character))
        }

    @Test
    fun `a clear in an earlier period does not block the mark`() =
        transaction {
            // Cleared once, three weeks ago, then dropped from the rotation. Only the period now in
            // progress can contradict the mark.
            val character = addCharacter(userOneId, "Lapsed")
            setBossClearByHand(userOneId, character, "jupiter", true, midWeek)

            assertNull(setBossSkip(userOneId, character, "jupiter", true, nextWeek))
            assertEquals(listOf("jupiter"), skipsOf(userOneId, character))
        }

    @Test
    fun `refuses a mark on a boss the character has a party for`() =
        transaction {
            // A config is (character, boss, difficulty, who with), which is the same claim in more
            // detail. The two cannot both be true, and the config is the one that says more.
            val character = addCharacter(userOneId, "Partied")
            Party.insert {
                it[id] = Uuid.random()
                it[userId] = userOneId
                it[characterId] = character
                it[bossCatalogId] = bossId("jupiter")
                it[createdAt] = midWeek
                it[updatedAt] = midWeek
            }

            assertEquals(SkipRefusal.HAS_PARTY, setBossSkip(userOneId, character, "jupiter", true, midWeek))
            assertEquals(emptyList(), skipsOf(userOneId, character))
        }

    @Test
    fun `making a party for a marked boss takes the mark back`() =
        transaction {
            // The other order of the same contradiction. The skip route refuses, so this one has to
            // resolve it, or a config and a "doesn't run" would sit side by side saying the
            // opposite of each other.
            val character = addCharacter(userOneId, "Recruited")
            setBossSkip(userOneId, character, "jupiter", true, midWeek)

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

            assertEquals(SkipRefusal.UNKNOWN, setBossSkip(userOneId, theirs, "jupiter", true, midWeek))
            assertEquals(SkipRefusal.UNKNOWN, setBossSkip(userOneId, mine, "not-a-boss", true, midWeek))
            assertEquals(emptyList(), skipsOf(userOneId, mine))
            assertEquals(emptyList(), skipsOf(userTwoId, theirs))
        }

    @Test
    fun `one user's marks stay out of another's matrix`() =
        transaction {
            val mine = addCharacter(userOneId, "Mine")
            val theirs = addCharacter(userTwoId, "Theirs")
            setBossSkip(userOneId, mine, "jupiter", true, midWeek)
            setBossSkip(userTwoId, theirs, "lotus", true, midWeek)

            assertEquals(mapOf(mine.toString() to listOf("jupiter")), bossSkipsFor(userOneId))
            assertEquals(mapOf(theirs.toString() to listOf("lotus")), bossSkipsFor(userTwoId))
        }

    @Test
    fun `marking twice is one row, not two`() =
        transaction {
            val character = addCharacter(userOneId, "Twice")
            setBossSkip(userOneId, character, "jupiter", true, midWeek)
            setBossSkip(userOneId, character, "jupiter", true, nextWeek)

            assertEquals(listOf("jupiter"), skipsOf(userOneId, character))
        }
}
