package com.maplestorage.backend.parties

import com.maplestorage.backend.bosses.weekOf
import com.maplestorage.backend.config.Env
import com.maplestorage.backend.db.Characters
import com.maplestorage.backend.db.Party
import com.maplestorage.backend.db.PartyMember
import com.maplestorage.backend.users.WORLD_INTERACTIVE
import com.maplestorage.backend.users.ensureUser
import kotlinx.datetime.DateTimeUnit
import kotlinx.datetime.LocalDate
import kotlinx.datetime.TimeZone
import kotlinx.datetime.plus
import kotlinx.datetime.toLocalDateTime
import org.flywaydb.core.Flyway
import org.jetbrains.exposed.v1.core.and
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
 * A week that was not the usual party, against a real Postgres.
 *
 * The claim worth a database is that "who is in this party" and "who ran it that week" are allowed
 * to differ WITHOUT either one quietly becoming the other. Two ways that goes wrong and both are a
 * confidently wrong number: a guest week that pays the member who sat it out, and a roster change
 * made today that rewrites a week already played.
 */
class PartyWeekRosterTest {
    private val userId = "user_test_week_roster"

    private fun todayUtc() =
        Clock.System
            .now()
            .toLocalDateTime(TimeZone.UTC)
            .date

    /** The week the app is in, which is the only one a roster may be written for. */
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

    /** Your character plus Steve and Bob, which is the usual party in every test here. */
    private fun trio(): PartyResponse {
        ensureUser(userId, "$userId@example.com")
        val mine = Uuid.random()
        val now = Clock.System.now()
        val owner = userId
        Characters.insert {
            it[Characters.id] = mine
            it[Characters.userId] = owner
            it[Characters.name] = "Rune"
            it[Characters.worldType] = WORLD_INTERACTIVE
            it[createdAt] = now
            it[updatedAt] = now
            it[position] = 0
        }
        val request = SavePartyRequest(mine.toString(), "limbo", listOf("Steve", "Bob"))
        val id = createParty(userId, mine, bossIdForKey("limbo")!!, request, now)
        return findParty(id, userId)!!
    }

    private fun context() = SeatContext(userId, emptyMap(), Clock.System.now())

    /** Cara in for Bob, this week only. */
    private fun caraForBob(
        party: PartyResponse,
        week: LocalDate = thisWeek(),
    ) = saveWeekRoster(
        Uuid.parse(party.id),
        Uuid.parse(party.characterId),
        week,
        listOf("Steve", "Cara"),
        context(),
    )

    private fun addGrindstoneOn(
        party: PartyResponse,
        on: LocalDate,
    ): Uuid =
        addLoot(
            Uuid.parse(party.id),
            dropIdForKey("grindstone-of-faith")!!,
            null,
            bossIdForKey("limbo"),
            on,
            Clock.System.now(),
        )

    @Test
    fun `a week nobody has said anything about runs the usual party`() {
        transaction {
            val party = trio()
            // The default, and the reason a week with no rows is the answer rather than a gap:
            // most weeks are simply the party, and they should cost nothing to record.
            assertEquals(listOf("Rune", "Steve", "Bob"), party.members.map { it.name })
            assertTrue(party.usualRoster)
            assertTrue(party.members.none { it.guest })
        }
    }

    @Test
    fun `a guest week says who ran, and leaves the party itself alone`() {
        transaction {
            val party = trio()
            caraForBob(party)

            val thisWeek = findParty(Uuid.parse(party.id), userId)!!
            assertEquals(listOf("Rune", "Steve", "Cara"), thisWeek.members.map { it.name })
            assertFalse(thisWeek.usualRoster)
            // Marked, because otherwise the only thing on screen saying this is not the usual
            // party would be remembering that it is not.
            assertTrue(thisWeek.members.single { it.name == "Cara" }.guest)

            // Next week has no rows of its own, so it is the party again. Reverting is the
            // default rather than something to remember to do.
            val partyId = Uuid.parse(party.id)
            val nextWeek = rosterFor(partyId, thisWeek().plus(DAYS_IN_WEEK, DateTimeUnit.DAY))
            assertEquals(3, nextWeek.size)
        }
    }

    @Test
    fun `a drop from a guest week owes the guest and not the member who sat out`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            caraForBob(party)

            // The money claim. Bob was not there, so he is owed nothing; Cara was, so she is.
            val lootId = addGrindstoneOn(party, todayUtc())
            val seats = findParty(partyId, userId)!!.members
            val seller = seats.first { it.name == "Rune" }
            sellLoot(
                lootId,
                SellLootRequest(9_000_000_000, "LISTED", "FAIR", seller.id),
                Uuid.parse(seller.id),
                partyId,
                Clock.System.now(),
            )

            val owed = findLoot(lootId, partyId)!!.payouts.map { it.memberId }.toSet()
            val bob = party.members.first { it.name == "Bob" }
            val cara = seats.first { it.name == "Cara" }
            assertEquals(setOf(seats.first { it.name == "Steve" }.id, cara.id), owed)
            assertFalse(bob.id in owed)
        }
    }

    @Test
    fun `putting the week back to the usual party is a deletion, not a copy of it`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            caraForBob(party)

            saveWeekRoster(partyId, Uuid.parse(party.characterId), thisWeek(), null, context())

            val back = findParty(partyId, userId)!!
            assertEquals(listOf("Rune", "Steve", "Bob"), back.members.map { it.name })
            assertTrue(back.usualRoster)
            // A copy would have frozen the week against the party: this proves it followed.
            saveParty(
                userId,
                partyId,
                SavePartyRequest(party.characterId, "limbo", listOf("Steve", "Bob", "Dana")),
                Clock.System.now(),
            )
            assertTrue(findParty(partyId, userId)!!.members.any { it.name == "Dana" })
        }
    }

    @Test
    fun `a week already played keeps its roster when the party changes afterwards`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            caraForBob(party)

            // Bob leaves the party for good, and Dana joins. The week Cara guested in is not
            // about either of them, and must not be rewritten by a decision taken after it.
            saveParty(
                userId,
                partyId,
                SavePartyRequest(party.characterId, "limbo", listOf("Steve", "Dana")),
                Clock.System.now(),
            )

            val week = findParty(partyId, userId)!!
            assertEquals(listOf("Rune", "Steve", "Cara"), week.members.map { it.name })
            // Cara's seat survived a save that named neither her nor Bob.
            assertEquals(1, seatsNamed(partyId, "Cara"))
        }
    }

    @Test
    fun `a guest who joins the party for good keeps the seat they guested in`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            caraForBob(party)
            val guested = findParty(partyId, userId)!!.members.first { it.name == "Cara" }

            saveParty(
                userId,
                partyId,
                SavePartyRequest(party.characterId, "limbo", listOf("Steve", "Bob", "Cara")),
                Clock.System.now(),
            )

            // One Cara, not two. A second seat would leave anything she was owed pointing at a
            // Cara who is no longer in the party.
            assertEquals(1, seatsNamed(partyId, "Cara"))
            // This week is still spelled out (Bob is still out of it), but she is not a guest in
            // the party any more.
            val now = findParty(partyId, userId)!!
            assertEquals(guested.id, now.members.first { it.name == "Cara" }.id)
            assertFalse(now.members.first { it.name == "Cara" }.guest)
        }
    }

    @Test
    fun `a drop carries the roster of its own week, not of the party today`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            val lootId = addGrindstoneOn(party, todayUtc())
            caraForBob(party)
            val cara = findParty(partyId, userId)!!.members.first { it.name == "Cara" }
            val bob = party.members.first { it.name == "Bob" }

            // What the seller select offers, so it offers exactly what the sell route accepts.
            // Bob did not run: naming him would make every share on this drop wrong.
            val ran = findLoot(lootId, partyId)!!.ranThatWeek
            assertTrue(cara.id in ran, "the guest who ran can be named as seller")
            assertFalse(bob.id in ran, "the member who sat out cannot")
        }
    }

    @Test
    fun `a guest stays readable as a seat after their week has passed`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            caraForBob(party)
            val cara = findParty(partyId, userId)!!.members.first { it.name == "Cara" }

            // Cara is owed for the drop she was there for, and the wallet reads a payout against
            // `seats`. If she were only in `members`, the week rolling over would take her out of
            // it and the split would go unreadable with the debt still real.
            val next = partiesFor(userId, thisWeek().plus(DAYS_IN_WEEK, DateTimeUnit.DAY))
            val row = next.first { it.id == party.id }
            assertTrue(row.members.none { it.name == "Cara" }, "not in next week's roster")
            assertTrue(row.seats.any { it.id == cara.id }, "still a seat the pool can name")
            assertTrue(row.usualRoster)
        }
    }

    @Test
    fun `your own character is in the week whether or not you name them`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            // The config IS that character, so a week cannot be run without them. Same rule the
            // usual roster keeps, and it has to be the same rule: they are the seat that sells
            // most drops, and an unnameable seller cannot pay anybody.
            caraForBob(party)
            assertEquals("Rune", findParty(partyId, userId)!!.members.first().name)
        }
    }

    private fun seatsNamed(
        partyId: Uuid,
        name: String,
    ) = PartyMember
        .selectAll()
        .where { (PartyMember.partyId eq partyId) and (PartyMember.name eq name) }
        .count()

    private companion object {
        const val DAYS_IN_WEEK = 7
    }
}
