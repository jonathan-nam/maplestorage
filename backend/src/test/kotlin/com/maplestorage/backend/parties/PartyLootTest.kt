package com.maplestorage.backend.parties

import com.maplestorage.backend.config.Env
import com.maplestorage.backend.db.Characters
import com.maplestorage.backend.db.Party
import com.maplestorage.backend.db.Person
import com.maplestorage.backend.users.WORLD_HEROIC
import com.maplestorage.backend.users.WORLD_INTERACTIVE
import com.maplestorage.backend.users.ensureUser
import kotlinx.datetime.LocalDate
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
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.time.Clock
import kotlin.time.Duration.Companion.days
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

    /** A second account, so the account-wide read has something it must not return. */
    private val strangerId = "user_test_loot_2"
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
        val owners = listOf(userId, strangerId)
        transaction {
            // party_loot and party_member cascade from party, and the payout rows cascade from the
            // loot. The character a config hangs off goes last.
            Party.deleteWhere { Party.userId inList owners }
            Person.deleteWhere { Person.userId inList owners }
            Characters.deleteWhere { Characters.userId inList owners }
        }
    }

    /** Your character plus two others, which is three seats: yours is stored as the first. */
    private fun trio(world: String = WORLD_INTERACTIVE): PartyResponse {
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
            it[Characters.worldType] = world
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

    @Test
    fun `a settled pool is still counted, so the row does not read as empty`() {
        transaction {
            // Paying the last share used to take the pool off the party's row entirely: both
            // counters went to zero and a party with a season of drops behind it looked exactly
            // like one that had never dropped anything.
            val party = trio()
            val partyId = Uuid.parse(party.id)
            val seller = party.members.first { it.name == "Rune" }

            addGrindstone(party) // stays in the pool
            val awaiting = addGrindstone(party)
            val done = addGrindstone(party)
            sellLoot(awaiting, sale(seller.id), Uuid.parse(seller.id), partyId, Clock.System.now())
            sellLoot(done, sale(seller.id), Uuid.parse(seller.id), partyId, Clock.System.now())
            findLoot(done, partyId)!!.payouts.forEach {
                setPayoutPaid(done, Uuid.parse(it.memberId), true, Clock.System.now())
            }

            val counts = lootCountsFor(listOf(partyId))[partyId]!!
            assertEquals(1, counts.pending)
            assertEquals(1, counts.awaitingPayout)
            assertEquals(1, counts.settled)

            // And it reaches the row the list draws.
            val row = findParty(partyId, userId)!!
            assertEquals(1, row.pendingLoot)
            assertEquals(1, row.awaitingPayout)
            assertEquals(1, row.settledLoot)
        }
    }

    @Test
    fun `the account-wide read is every pool of yours and none of anybody else's`() {
        transaction {
            // Two configs of your own, and a stranger's with loot in it. The wallet nets what you
            // owe against what you are owed, so a pool that leaked in from another account would
            // put somebody else's debt in your total.
            val limbo = trio()
            val mine = Uuid.parse(limbo.characterId)
            val kalos =
                createParty(
                    userId,
                    mine,
                    bossIdForKey("kalos-the-guardian")!!,
                    SavePartyRequest(limbo.characterId, "kalos-the-guardian", listOf("Steve")),
                    Clock.System.now(),
                )
            addGrindstone(limbo)
            addLoot(kalos, dropIdForKey("grindstone-of-faith")!!, null, null, dropped, Clock.System.now())
            addLoot(Uuid.parse(strangerParty().id), null, "Not yours", null, dropped, Clock.System.now())

            val pools = allLootFor(userId)
            assertEquals(setOf(limbo.id, kalos.toString()), pools.map { it.partyId }.toSet())
            assertEquals(2, pools.sumOf { it.loot.size })
            // The same rows lootFor returns, so the wallet and a party's own page read one shape.
            assertEquals(
                lootFor(Uuid.parse(limbo.id)),
                pools.single { it.partyId == limbo.id }.loot,
            )
        }
    }

    @Test
    fun `settling clears the named rows across parties, whichever seat is owed`() {
        transaction {
            // Paying one person for what they are owed everywhere is ONE transfer, so it is one
            // call. Both directions in it: you sold in the first party, they sold in the second,
            // and the payout row is against a different seat each time.
            val limbo = trio()
            val limboId = Uuid.parse(limbo.id)
            val kalosId =
                createParty(
                    userId,
                    Uuid.parse(limbo.characterId),
                    bossIdForKey("kalos-the-guardian")!!,
                    SavePartyRequest(limbo.characterId, "kalos-the-guardian", listOf("Steve")),
                    Clock.System.now(),
                )
            val kalos = findParty(kalosId, userId)!!

            val yourSale = addGrindstone(limbo)
            val you = limbo.members.first { it.name == "Rune" }
            sellLoot(yourSale, sale(you.id), Uuid.parse(you.id), limboId, Clock.System.now())

            val theirSale =
                addLoot(kalosId, dropIdForKey("grindstone-of-faith")!!, null, null, dropped, Clock.System.now())
            val them = kalos.members.first { it.name == "Steve" }
            sellLoot(theirSale, sale(them.id), Uuid.parse(them.id), kalosId, Clock.System.now())

            val refs =
                findLoot(yourSale, limboId)!!.payouts.map { yourSale to Uuid.parse(it.memberId) } +
                    findLoot(theirSale, kalosId)!!.payouts.map { theirSale to Uuid.parse(it.memberId) }

            assertTrue(settlePayouts(userId, refs, Clock.System.now()))
            assertEquals(STATUS_PAID_OUT, findLoot(yourSale, limboId)!!.status)
            assertEquals(STATUS_PAID_OUT, findLoot(theirSale, kalosId)!!.status)
        }
    }

    @Test
    fun `a settle naming a row it cannot reach writes nothing at all`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            val lootId = addGrindstone(party)
            val seller = party.members.first { it.name == "Rune" }
            sellLoot(lootId, sale(seller.id), Uuid.parse(seller.id), partyId, Clock.System.now())
            val ours = findLoot(lootId, partyId)!!.payouts.map { lootId to Uuid.parse(it.memberId) }

            val stranger = strangerParty()
            val strangerPartyId = Uuid.parse(stranger.id)
            val strangerLoot =
                addLoot(
                    strangerPartyId,
                    dropIdForKey("grindstone-of-faith")!!,
                    null,
                    null,
                    dropped,
                    Clock.System.now(),
                )
            val theirSeller = stranger.members.first { it.name == "Stranger" }.id
            sellLoot(
                strangerLoot,
                sale(theirSeller),
                Uuid.parse(theirSeller),
                strangerPartyId,
                Clock.System.now(),
            )
            val theirs =
                findLoot(strangerLoot, strangerPartyId)!!.payouts.map {
                    strangerLoot to Uuid.parse(it.memberId)
                }

            // A seat that is not on this drop's roster, and a row in somebody else's party. Each
            // takes the whole settle down with it: paying for the rows it COULD reach would leave
            // the wallet short by the rest, with nothing on screen saying which.
            assertFalse(settlePayouts(userId, ours + (lootId to Uuid.random()), Clock.System.now()))
            assertFalse(settlePayouts(userId, ours + theirs, Clock.System.now()))

            assertEquals(STATUS_SOLD, findLoot(lootId, partyId)!!.status)
            assertTrue(findLoot(lootId, partyId)!!.payouts.none { it.paid })
            assertTrue(findLoot(strangerLoot, strangerPartyId)!!.payouts.none { it.paid })
        }
    }

    @Test
    fun `settling twice leaves the row that was already paid as it was`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            val lootId = addGrindstone(party)
            val seller = party.members.first { it.name == "Rune" }
            sellLoot(lootId, sale(seller.id), Uuid.parse(seller.id), partyId, Clock.System.now())

            val payouts = findLoot(lootId, partyId)!!.payouts
            val early = payouts.first().memberId
            setPayoutPaid(lootId, Uuid.parse(early), true, Clock.System.now() - 1.days)
            val paidAt = findLoot(lootId, partyId)!!.payouts.single { it.memberId == early }.paidAt

            assertTrue(settlePayouts(userId, payouts.map { lootId to Uuid.parse(it.memberId) }, Clock.System.now()))

            val after = findLoot(lootId, partyId)!!
            assertEquals(STATUS_PAID_OUT, after.status)
            // paidAt is the record of when the money moved. A settle sent twice is one payment,
            // and re-stamping it would date the transfer to the second click.
            assertEquals(paidAt, after.payouts.single { it.memberId == early }.paidAt)
        }
    }

    @Test
    fun `a Heroic world config cannot sell, and says which world it is in`() {
        transaction {
            val heroic = trio(WORLD_HEROIC)
            // Carried on the config, so the client does not have to fetch the character to find
            // out whether this pool's drops are worth a price box.
            assertEquals(WORLD_HEROIC, heroic.worldType)
            assertFalse(partyCanSell(Uuid.parse(heroic.id)))
        }
    }

    @Test
    fun `an Interactive world config still sells`() {
        transaction {
            // The half of the rule that is easy to break by getting the comparison backwards, and
            // which no Heroic test would catch: every existing pool would silently stop selling.
            val party = trio()
            assertEquals(WORLD_INTERACTIVE, party.worldType)
            assertTrue(partyCanSell(Uuid.parse(party.id)))
        }
    }

    /** A second account with a config of its own, to prove the ownership filter above. */
    private fun strangerParty(): PartyResponse {
        ensureUser(strangerId, "$strangerId@example.com")
        val theirs = Uuid.random()
        val now = Clock.System.now()
        val owner = strangerId
        Characters.insert {
            it[Characters.id] = theirs
            it[Characters.userId] = owner
            it[Characters.name] = "Stranger"
            it[createdAt] = now
            it[updatedAt] = now
            it[position] = 0
        }
        val request = SavePartyRequest(theirs.toString(), "limbo", listOf("Nobody"))
        return findParty(createParty(strangerId, theirs, bossIdForKey("limbo")!!, request, now), strangerId)!!
    }
}
