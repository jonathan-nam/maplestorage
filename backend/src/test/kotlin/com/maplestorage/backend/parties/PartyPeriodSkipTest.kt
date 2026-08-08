package com.maplestorage.backend.parties

import com.maplestorage.backend.bosses.periodStartFor
import com.maplestorage.backend.bosses.weekOf
import com.maplestorage.backend.config.Env
import com.maplestorage.backend.db.BossCatalog
import com.maplestorage.backend.db.Characters
import com.maplestorage.backend.db.Party
import com.maplestorage.backend.users.WORLD_INTERACTIVE
import com.maplestorage.backend.users.ensureUser
import kotlinx.datetime.DateTimeUnit
import kotlinx.datetime.LocalDate
import kotlinx.datetime.TimeZone
import kotlinx.datetime.plus
import kotlinx.datetime.toLocalDateTime
import org.flywaydb.core.Flyway
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
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
import kotlin.test.assertTrue
import kotlin.time.Clock
import kotlin.uuid.Uuid

/**
 * A period the party is not running, against a real Postgres.
 *
 * The claim worth a database is that a week off costs nothing but the week. The config, its seats
 * and its pool all survive it, the next period runs as usual with nobody saying so, and the period
 * a mark is filed under is the BOSS's, so the Black Mage is taken off its month rather than off one
 * Thursday inside it.
 */
class PartyPeriodSkipTest {
    private val userId = "user_test_period_skip"

    private fun todayUtc() =
        Clock.System
            .now()
            .toLocalDateTime(TimeZone.UTC)
            .date

    private fun thisWeek() = weekOf(todayUtc())

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
        // Held in a local: inside deleteWhere {} the TABLE is the receiver, so a bare `userId`
        // binds to the COLUMN and the predicate is true of every row. See PartyLootTest.
        val owners = listOf(userId)
        transaction {
            Party.deleteWhere { Party.userId inList owners }
            Characters.deleteWhere { Characters.userId inList owners }
        }
    }

    private fun mine(): Uuid {
        ensureUser(userId, "$userId@example.com")
        val id = Uuid.random()
        val now = Clock.System.now()
        val owner = userId
        Characters.insert {
            it[Characters.id] = id
            it[Characters.userId] = owner
            it[Characters.name] = "Rune"
            it[Characters.worldType] = WORLD_INTERACTIVE
            it[createdAt] = now
            it[updatedAt] = now
            it[position] = 0
        }
        return id
    }

    private fun partyOn(
        characterId: Uuid,
        bossKey: String,
    ): PartyResponse {
        val now = Clock.System.now()
        val request = SavePartyRequest(characterId.toString(), bossKey, listOf("Steve", "Bob"))
        val id = createParty(userId, characterId, bossIdForKey(bossKey)!!, request, now)
        return findParty(id, userId)!!
    }

    /** The period the app is in for this boss, which is the only one that may be written. */
    private fun periodOfBoss(bossKey: String): LocalDate {
        val reset =
            BossCatalog
                .selectAll()
                .where { BossCatalog.bossKey eq bossKey }
                .first()[BossCatalog.reset]
        return periodStartFor(reset, Clock.System.now())
    }

    private fun takeOff(
        party: PartyResponse,
        skipped: Boolean = true,
    ) = setPeriodSkip(
        Uuid.parse(party.id),
        periodOfBoss(party.bossKey),
        skipped,
        Clock.System.now(),
    )

    @Test
    fun `a period nobody has said anything about runs as usual`() {
        transaction {
            val party = partyOn(mine(), "limbo")
            assertFalse(party.skippedThisPeriod)
            assertFalse(partiesFor(userId).first { it.id == party.id }.skippedThisPeriod)
        }
    }

    @Test
    fun `a boss taken off says so, on the list as well as on the row`() {
        transaction {
            val party = partyOn(mine(), "limbo")
            takeOff(party)

            assertTrue(findParty(Uuid.parse(party.id), userId)!!.skippedThisPeriod)
            assertTrue(partiesFor(userId).first { it.id == party.id }.skippedThisPeriod)
        }
    }

    @Test
    fun `a week off keeps the config, its seats and its pool`() {
        transaction {
            val party = partyOn(mine(), "limbo")
            addLoot(
                Uuid.parse(party.id),
                dropIdForKey("grindstone-of-faith")!!,
                null,
                bossIdForKey("limbo"),
                todayUtc(),
                Clock.System.now(),
            )
            takeOff(party)

            // The failure this guards: saying "not this week" by deleting the config, which takes
            // the seats and a drop somebody is still owed a share of with it.
            val after = findParty(Uuid.parse(party.id), userId)!!
            assertEquals(3, after.seats.size)
            assertEquals(3, after.members.size)
            assertEquals(1, after.pendingLoot)
        }
    }

    @Test
    fun `putting it back is a deletion, so the next period runs without being told to`() {
        transaction {
            val party = partyOn(mine(), "limbo")
            takeOff(party)
            takeOff(party, skipped = false)

            assertFalse(findParty(Uuid.parse(party.id), userId)!!.skippedThisPeriod)
            // Not a row saying false: a stored false would have to be cleared every period, and the
            // period that forgot to would read as taken off.
            assertFalse(isPeriodSkipped(Uuid.parse(party.id), periodOfBoss("limbo")))
        }
    }

    @Test
    fun `a week taken off leaves the next week alone`() {
        transaction {
            val party = partyOn(mine(), "limbo")
            takeOff(party)

            val next = partiesFor(userId, thisWeek().plus(DAYS_IN_WEEK, DateTimeUnit.DAY))
            assertFalse(next.first { it.id == party.id }.skippedThisPeriod)
        }
    }

    @Test
    fun `saying it twice says it once`() {
        transaction {
            val party = partyOn(mine(), "limbo")
            takeOff(party)
            takeOff(party)

            assertTrue(findParty(Uuid.parse(party.id), userId)!!.skippedThisPeriod)
        }
    }

    @Test
    fun `the period a mark is filed under is the boss's own`() {
        transaction {
            val character = mine()
            val monthly = partyOn(character, "black-mage")
            val weekly = partyOn(character, "limbo")

            // The failure this guards: one date for every boss. The Black Mage sits in a month-long
            // period, so a mark filed under this Thursday would read as not-taken-off for most of
            // the month, and boss_clear, which IS filed by month, would disagree with it.
            assertEquals(thisWeek(), periodOfBoss("limbo"))
            assertEquals(periodStartFor("MONTHLY", Clock.System.now()), periodOfBoss("black-mage"))

            takeOff(monthly)
            assertTrue(isPeriodSkipped(Uuid.parse(monthly.id), periodOfBoss("black-mage")))
            assertTrue(findParty(Uuid.parse(monthly.id), userId)!!.skippedThisPeriod)
            assertFalse(findParty(Uuid.parse(weekly.id), userId)!!.skippedThisPeriod)
        }
    }

    @Test
    fun `one config taken off leaves the others on`() {
        transaction {
            val character = mine()
            val off = partyOn(character, "limbo")
            val on = partyOn(character, "kalos-the-guardian")
            takeOff(off)

            val list = partiesFor(userId).associateBy { it.id }
            assertTrue(list[off.id]!!.skippedThisPeriod)
            assertFalse(list[on.id]!!.skippedThisPeriod)
        }
    }

    private companion object {
        const val DAYS_IN_WEEK = 7
    }
}
