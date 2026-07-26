package com.maplestorage.backend.parties

import com.maplestorage.backend.config.Env
import com.maplestorage.backend.db.Characters
import com.maplestorage.backend.db.Party
import com.maplestorage.backend.db.Person
import com.maplestorage.backend.users.ensureUser
import kotlinx.datetime.LocalDate
import org.flywaydb.core.Flyway
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.jdbc.Database
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insert
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
        // Held in a local, and this is not a style choice. Inside deleteWhere {} the TABLE is a
        // receiver, so a bare `userId` binds to Characters.userId, the COLUMN: the predicate reads
        // userId = userId, which is true of every row, and the delete takes the whole table. A
        // function parameter shadows the receiver and hides this; a class property does not. It
        // emptied the dev database's characters once, and boss_clear and character_token_count
        // cascaded with them.
        val owner = userId
        transaction {
            // party_loot and party_member cascade from party, and the payout rows cascade from the
            // loot. The character a config hangs off goes last.
            Party.deleteWhere { Party.userId eq owner }
            Person.deleteWhere { Person.userId eq owner }
            Characters.deleteWhere { Characters.userId eq owner }
        }
    }

    /** Your character plus two others, which is three seats: yours is stored as the first. */
    private fun trio(): PartyResponse {
        ensureUser(userId, "$userId@example.com")
        val mine = Uuid.random()
        val now = Clock.System.now()
        // Held in a local first: inside insert {} the TABLE is the receiver, so a bare `userId`
        // resolves to Characters.userId, the column, and the insert asks Postgres to store a
        // column reference. A function parameter shadows the receiver and hides this; a class
        // property does not.
        val owner = userId
        Characters.insert {
            it[Characters.id] = mine
            it[Characters.userId] = owner
            it[Characters.name] = "Rune"
            it[createdAt] = now
            it[updatedAt] = now
            it[position] = 0
        }
        val request = SavePartyRequest(mine.toString(), "limbo", listOf("Steve", "Bob"))
        val id = createParty(userId, mine, bossIdForKey("limbo")!!, request, now)
        return findParty(id, userId)!!
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

            // The same config with one more person in it.
            val others = party.members.drop(1).map { it.name } + "Cara"
            val grown = SavePartyRequest(party.characterId, "limbo", others)
            saveParty(userId, partyId, grown, Clock.System.now())

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

            // Dropping Bob from the roster deletes the seat his payout points at, and the payout
            // goes with it. That is why the route refuses to delete a config whose pool still has
            // anything in it: the record has to outlive the editing.
            val withoutBob =
                party.members
                    .drop(1)
                    .filter { it.name != "Bob" }
                    .map { it.name }
            val request = SavePartyRequest(party.characterId, "limbo", withoutBob)
            saveParty(userId, partyId, request, Clock.System.now())

            val after = findParty(partyId, userId)!!
            assertTrue(after.members.none { it.name == "Bob" })
            assertEquals(1, findLoot(lootId, partyId)!!.payouts.size)
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
