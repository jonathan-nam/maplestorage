package com.sharpeyes.backend.parties

import com.sharpeyes.backend.bosses.weekOf
import com.sharpeyes.backend.config.Env
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.users.WORLD_INTERACTIVE
import com.sharpeyes.backend.users.ensureUser
import kotlinx.datetime.DateTimeUnit
import kotlinx.datetime.LocalDate
import kotlinx.datetime.TimeZone
import kotlinx.datetime.plus
import kotlinx.datetime.toLocalDateTime
import org.flywaydb.core.Flyway
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.jdbc.Database
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import kotlin.time.Clock
import kotlin.uuid.Uuid

/**
 * A one night party, against a real Postgres.
 *
 * The claim worth a database is that a one-off's people are in the night and in no week after it.
 * Written as standing seats they were the fallback for every week nobody answered for, so a boss run
 * alone a fortnight later split with a guest who was not there and paid them. That is the failure
 * this repo exists to prevent, reached through Add Drop.
 */
class OneOffRosterTest {
    private val userId = "user_test_one_off_roster"

    private fun todayUtc() =
        Clock.System
            .now()
            .toLocalDateTime(TimeZone.UTC)
            .date

    private fun thisWeek() = weekOf(todayUtc())

    private fun nextWeek() = thisWeek().plus(7, DateTimeUnit.DAY)

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

    private fun mine(named: String): Uuid {
        ensureUser(userId, "$userId@example.com")
        val id = Uuid.random()
        val now = Clock.System.now()
        val owner = userId
        Characters.insert {
            it[Characters.id] = id
            it[Characters.userId] = owner
            it[Characters.name] = named
            it[Characters.worldType] = WORLD_INTERACTIVE
            it[createdAt] = now
            it[updatedAt] = now
            it[position] = 0
        }
        return id
    }

    private fun nightOn(
        characterId: Uuid,
        bossKey: String = "limbo",
        members: List<String> = listOf("Steve"),
        oneOff: Boolean = true,
    ): PartyResponse {
        val request = SavePartyRequest(characterId.toString(), bossKey, members, oneOff = oneOff)
        val id = createParty(userId, characterId, bossIdForKey(bossKey)!!, request, Clock.System.now())
        return findParty(id, userId)!!
    }

    private fun namesIn(
        party: PartyResponse,
        week: LocalDate,
    ): List<String> = rosterNamesFor(Uuid.parse(party.id), week)

    @Test
    fun `the night names the people it was made with`() {
        transaction {
            val party = nightOn(mine("Rune"))
            assertEquals(listOf("Rune", "Steve"), namesIn(party, thisWeek()))
            assertEquals(listOf("Rune", "Steve"), party.members.map { it.name })
        }
    }

    @Test
    fun `a week after the night is you alone`() {
        transaction {
            val party = nightOn(mine("Rune"))
            // The bug, in one line: Steve was a standing seat, so every later week fell back to him
            // and a solo kill divided in two.
            assertEquals(listOf("Rune"), namesIn(party, nextWeek()))
        }
    }

    @Test
    fun `a standing party still runs its usual roster every week`() {
        transaction {
            val party = nightOn(mine("Rune"), oneOff = false)
            assertEquals(listOf("Rune", "Steve"), namesIn(party, thisWeek()))
            assertEquals(listOf("Rune", "Steve"), namesIn(party, nextWeek()))
        }
    }

    @Test
    fun `a drop already in the week is not held out of the night it fell on`() {
        transaction {
            val own = mine("Rune")
            val boss = bossIdForKey("limbo")!!
            // A solo pool with a drop in it, which is what logging one on a boss with no party
            // opens. Naming the night afterwards used to leave the week pinned to the roster of one
            // that was there before, so the people it was made with showed up in no week at all.
            val pool = poolFor(userId, own, boss, Clock.System.now())
            addLoot(pool, LootedDrop(dropIdForKey("grindstone-of-faith")!!), boss, todayUtc(), Clock.System.now())

            val request = SavePartyRequest(own.toString(), "limbo", listOf("Steve"), oneOff = true)
            takeOverParty(userId, pool, request, Clock.System.now())

            assertEquals(listOf("Rune", "Steve"), rosterNamesFor(pool, thisWeek()))
            assertEquals(listOf("Rune"), rosterNamesFor(pool, nextWeek()))
        }
    }

    @Test
    fun `one guest cannot run the same boss on two nights in one week`() {
        transaction {
            nightOn(mine("Rune"))
            // Steve's clear is spent on the first night, and the seat holding it is no longer a
            // standing one, so only the WEEK can still say so. See validateNight.
            val second =
                SavePartyRequest(mine("Kade").toString(), "limbo", listOf("Steve"), oneOff = true)
            val refusal =
                validateNewParty(
                    second,
                    userId,
                    Uuid.parse(second.characterId),
                    bossIdForKey("limbo"),
                    Clock.System.now(),
                )
            assertNotNull(refusal)
            assertTrue(refusal.contains("Steve"), refusal)
        }
    }
}
