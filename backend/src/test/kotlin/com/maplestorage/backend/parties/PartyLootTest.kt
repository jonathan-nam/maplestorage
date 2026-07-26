package com.maplestorage.backend.parties

import com.maplestorage.backend.config.Env
import com.maplestorage.backend.db.Party
import com.maplestorage.backend.db.Person
import com.maplestorage.backend.users.ensureUser
import kotlinx.datetime.LocalDate
import org.flywaydb.core.Flyway
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.jdbc.Database
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
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
 * The loot pool, against a real Postgres.
 *
 * The claims worth a database to check are all about the PAYOUT ROSTER: that it is pinned when the
 * drop sells rather than re-read from the party afterwards, that correcting a price does not wipe
 * out who has been paid, and that a seat the roster names cannot be quietly removed. Getting any
 * of those wrong produces a payout list that looks right and owes the wrong people.
 */
class PartyLootTest {
    private val userId = "user_test_loot_1"
    private val dropped = LocalDate.parse("2026-07-20")

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
            // party_loot and party_member cascade from party, and the payout rows cascade from the
            // loot. People are referenced by the seats, so they can only go once the parties have.
            Party.deleteWhere { Party.userId eq userId }
            Person.deleteWhere { Person.userId eq userId }
        }
    }

    private fun trio(): PartyResponse {
        ensureUser(userId, "$userId@example.com")
        val people =
            listOf(
                GridPersonRequest(key = "me", name = "Me"),
                GridPersonRequest(key = "steve", name = "Steve", mvp = true),
                GridPersonRequest(key = "bob", name = "Bob"),
            )
        val seats =
            listOf(
                GridSeatRequest("me", "Rune"),
                GridSeatRequest("steve", "Steve"),
                GridSeatRequest("bob", "Bob"),
            )
        val party = GridPartyRequest(name = "Limbo trio", bossKeys = listOf("limbo"), seats = seats)
        return saveGrid(userId, SaveGridRequest(people, listOf(party)), Clock.System.now()).parties.single()
    }

    private fun addGrindstone(party: PartyResponse): Uuid {
        val dropId = dropIdForKey("grindstone-of-faith")!!
        return addLoot(Uuid.parse(party.id), dropId, null, bossIdForKey("limbo"), dropped, Clock.System.now())
    }

    private fun sale(sellerId: String) = SellLootRequest(9_500_000_000, "LISTED", "FAIR", sellerId)

    @Test
    fun `a catalog drop carries its name, art and per-member warning onto the row`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            val ringId = dropIdForKey("ring-of-restraint-4")!!
            addLoot(partyId, ringId, null, bossIdForKey("limbo"), dropped, Clock.System.now())

            val loot = lootFor(partyId).single()
            assertEquals("Ring of Restraint Lv. 4", loot.name)
            assertEquals("/drop-icons/ring-of-restraint-4.png", loot.iconUrl)
            // The flag that stops a party splitting six ways something they each already hold.
            assertEquals("HEROIC", loot.perMember)
            assertEquals("limbo", loot.bossKey)
            assertEquals(STATUS_PENDING, loot.status)
            assertTrue(loot.payouts.isEmpty())
        }
    }

    @Test
    fun `selling owes everyone but the seller, and paying them all closes the drop`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            val lootId = addGrindstone(party)
            val seller = party.members.first { it.name == "Rune" }

            sellLoot(lootId, sale(seller.id), Uuid.parse(seller.id), partyId, Clock.System.now())

            val sold = findLoot(lootId, partyId)!!
            assertEquals(STATUS_SOLD, sold.status)
            assertEquals(9_500_000_000, sold.saleAmount)
            // The seller is not owed a payout; they are holding the mesos.
            assertEquals(
                party.members
                    .filter { it.name != "Rune" }
                    .map { it.id }
                    .toSet(),
                sold.payouts.map { it.memberId }.toSet(),
            )

            sold.payouts.forEach { setPayoutPaid(lootId, Uuid.parse(it.memberId), true, Clock.System.now()) }
            val closed = findLoot(lootId, partyId)!!
            assertEquals(STATUS_PAID_OUT, closed.status)
            assertTrue(closed.payouts.all { it.paid && it.paidAt != null })
        }
    }

    @Test
    fun `correcting the price leaves who has been paid alone`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            val lootId = addGrindstone(party)
            val seller = party.members[0]
            sellLoot(lootId, sale(seller.id), Uuid.parse(seller.id), partyId, Clock.System.now())

            val steve = party.members.first { it.name == "Steve" }
            setPayoutPaid(lootId, Uuid.parse(steve.id), true, Clock.System.now())

            // Sold again with a corrected figure and the other split method.
            val corrected = SellLootRequest(8_000_000_000, "RECEIVED", "LAZY", seller.id)
            sellLoot(lootId, corrected, Uuid.parse(seller.id), partyId, Clock.System.now())

            val loot = findLoot(lootId, partyId)!!
            assertEquals(8_000_000_000, loot.saleAmount)
            assertEquals("RECEIVED", loot.amountBasis)
            assertEquals("LAZY", loot.splitMethod)
            assertEquals(2, loot.payouts.size)
            assertTrue(loot.payouts.single { it.memberId == steve.id }.paid)
        }
    }

    @Test
    fun `a member who joins after the sale is not owed for it`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            val lootId = addGrindstone(party)
            val seller = party.members[0]
            sellLoot(lootId, sale(seller.id), Uuid.parse(seller.id), partyId, Clock.System.now())

            // The same grid with one more column, and a cell for her in this row.
            val people =
                peopleFor(userId).map { GridPersonRequest(key = it.id, id = it.id, name = it.name, mvp = it.mvp) } +
                    GridPersonRequest(key = "cara", name = "Cara")
            val seats =
                party.members.map { GridSeatRequest(it.personId, it.name) } + GridSeatRequest("cara", "Cara")
            val grown = GridPartyRequest(party.id, "Limbo trio", listOf("limbo"), seats)
            saveGrid(userId, SaveGridRequest(people, listOf(grown)), Clock.System.now())

            // Still three seats' worth of history: the fourth was not there when it sold.
            val loot = findLoot(lootId, partyId)!!
            assertEquals(2, loot.payouts.size)
            assertTrue(loot.payouts.none { payout -> payout.memberId !in party.members.map { it.id } })
        }
    }

    @Test
    fun `a seat the loot pool points at cannot be dropped from the party`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            val lootId = addGrindstone(party)
            val seller = party.members[0]
            sellLoot(lootId, sale(seller.id), Uuid.parse(seller.id), partyId, Clock.System.now())

            val people = peopleFor(userId)
            val kept = people.map { GridPersonRequest(key = it.id, id = it.id, name = it.name, mvp = it.mvp) }
            val withoutBob = party.members.filter { it.name != "Bob" }.map { GridSeatRequest(it.personId, it.name) }
            val request =
                SaveGridRequest(kept, listOf(GridPartyRequest(party.id, "Limbo trio", listOf("limbo"), withoutBob)))
            val problem =
                validateGrid(
                    request,
                    userId,
                    people.map { Uuid.parse(it.id) }.toSet(),
                    setOf(partyId),
                )
            // Bob's column stays; it is his SEAT in this row that the payout points at, and the
            // grid cannot drop the cell without dropping the record.
            assertEquals(
                "a person with loot history cannot be removed, delete or reassign their loot first",
                problem,
            )
        }
    }

    @Test
    fun `unselling puts the drop back and takes the payout record with it`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            val lootId = addGrindstone(party)
            val seller = party.members[0]
            sellLoot(lootId, sale(seller.id), Uuid.parse(seller.id), partyId, Clock.System.now())

            unsellLoot(lootId, Clock.System.now())

            val loot = findLoot(lootId, partyId)!!
            assertEquals(STATUS_PENDING, loot.status)
            assertNull(loot.saleAmount)
            assertNull(loot.sellerMemberId)
            assertTrue(loot.payouts.isEmpty())
            // The seat is free again once nothing points at it.
            assertTrue(seatsWithLootHistory(partyId).isEmpty())
        }
    }

    @Test
    fun `deleting a party takes its loot and payouts with it`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            val lootId = addGrindstone(party)
            val seller = party.members[0]
            sellLoot(lootId, sale(seller.id), Uuid.parse(seller.id), partyId, Clock.System.now())
            assertNotNull(findLoot(lootId, partyId))

            // party_loot_payout points at party_member, which cascades from party. If that FK were
            // RESTRICT this would fail rather than clean up.
            assertTrue(deleteParty(partyId, userId))
            assertTrue(lootFor(partyId).isEmpty())
        }
    }

    @Test
    fun `free-text loot is allowed and keeps the name it was given`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            addLoot(partyId, null, "Some untabled mount", null, dropped, Clock.System.now())

            val loot = lootFor(partyId).single()
            assertEquals("Some untabled mount", loot.name)
            assertNull(loot.dropKey)
            assertNull(loot.iconUrl)
        }
    }
}
