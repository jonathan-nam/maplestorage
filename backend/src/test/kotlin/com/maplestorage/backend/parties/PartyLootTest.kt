package com.maplestorage.backend.parties

import com.maplestorage.backend.config.Env
import com.maplestorage.backend.db.Characters
import com.maplestorage.backend.db.Party
import com.maplestorage.backend.db.Person
import com.maplestorage.backend.users.WORLD_HEROIC
import com.maplestorage.backend.users.WORLD_INTERACTIVE
import com.maplestorage.backend.users.ensureUser
import kotlinx.datetime.DateTimeUnit
import kotlinx.datetime.LocalDate
import kotlinx.datetime.TimeZone
import kotlinx.datetime.minus
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

    /** The Thursday `dropped` falls after, and the next one. Reset is Thursday 00:00 UTC. */
    private val weekOf20Jul = LocalDate.parse("2026-07-16")
    private val weekAfter20Jul = LocalDate.parse("2026-07-23")

    private fun todayUtc() =
        Clock.System
            .now()
            .toLocalDateTime(TimeZone.UTC)
            .date

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

    private fun sale(sellerId: String) = SellLootRequest(9_500_000_000, "LISTED", "FAIR", sellerId)

    /** Pays every share on a sold drop, so it lands in `settled`. */
    private fun settle(
        lootId: Uuid,
        partyId: Uuid,
    ) = findLoot(lootId, partyId)!!.payouts.forEach {
        setPayoutPaid(lootId, Uuid.parse(it.memberId), true, Clock.System.now())
    }

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

            // Bob's payout points at his seat, and party_loot_payout cascades on it, so deleting
            // the seat would delete the record while the money stays real. Refused instead.
            val withoutBob =
                party.members
                    .drop(1)
                    .filter { it.name != "Bob" }
                    .map { it.name }
            val characterId = Uuid.parse(party.characterId)
            val problem = validateSeatRemovals(partyId, characterId, withoutBob)
            assertNotNull(problem)
            assertTrue(problem.contains("Bob"), problem)

            // And the one it is protecting is untouched by the refusal.
            assertTrue(findParty(partyId, userId)!!.members.any { it.name == "Bob" })
            assertEquals(2, findLoot(lootId, partyId)!!.payouts.size)
        }
    }

    @Test
    fun `a seat with no loot behind it still leaves`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            val characterId = Uuid.parse(party.characterId)

            // Nothing has dropped, so nothing points at anybody: an ordinary roster change.
            val withoutBob =
                party.members
                    .drop(1)
                    .filter { it.name != "Bob" }
                    .map { it.name }
            assertNull(validateSeatRemovals(partyId, characterId, withoutBob))

            saveParty(userId, partyId, SavePartyRequest(party.characterId, "limbo", withoutBob), Clock.System.now())
            assertTrue(findParty(partyId, userId)!!.members.none { it.name == "Bob" })
        }
    }

    @Test
    fun `a seat that joined after the sale can still leave`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            val characterId = Uuid.parse(party.characterId)
            val lootId = addGrindstone(party)
            val seller = party.members[0]
            sellLoot(lootId, sale(seller.id), Uuid.parse(seller.id), partyId, Clock.System.now())

            // The lock is per SEAT, not per party: a sale does not freeze the roster, it pins the
            // people it owes. Cara was not there for it, so she comes and goes freely.
            val withCara = party.members.drop(1).map { it.name } + "Cara"
            saveParty(userId, partyId, SavePartyRequest(party.characterId, "limbo", withCara), Clock.System.now())
            assertNull(validateSeatRemovals(partyId, characterId, party.members.drop(1).map { it.name }))
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

            val counts = lootCountsFor(listOf(partyId), week = null)[partyId]!!
            assertEquals(1, counts.pending)
            assertEquals(1, counts.awaitingPayout)
            assertEquals(1, counts.settled)

            // And it reaches the row the party's own page draws, which is all time.
            val row = findParty(partyId, userId)!!
            assertEquals(1, row.pendingLoot)
            assertEquals(1, row.awaitingPayout)
            assertEquals(1, row.settledLoot)
        }
    }

    // The four claims the week rule is made of. Party View's badge sits beside a clear tick that
    // already answers for one week, so a badge counting every drop ever put two periods on one row.
    //
    // `dropped` is 20 Jul 2026, a Monday, so its week is the one starting Thursday the 16th.

    @Test
    fun `a settled drop counts in its own week and in no later one`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            val seller = party.members.first { it.name == "Rune" }
            val done = addGrindstone(party)
            sellLoot(done, sale(seller.id), Uuid.parse(seller.id), partyId, Clock.System.now())
            settle(done, partyId)

            assertEquals(1, lootCountsFor(listOf(partyId), weekOf20Jul)[partyId]!!.settled)

            // Nothing left to do with it, so it stays in the week it happened in.
            val next = lootCountsFor(listOf(partyId), weekAfter20Jul)[partyId]!!
            assertEquals(0, next.settled)
            assertEquals(0, next.pending)
            assertEquals(0, next.awaitingPayout)
        }
    }

    @Test
    fun `an unsold drop and an unpaid one both carry into later weeks`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            val seller = party.members.first { it.name == "Rune" }
            addGrindstone(party) // never sold
            val awaiting = addGrindstone(party)
            sellLoot(awaiting, sale(seller.id), Uuid.parse(seller.id), partyId, Clock.System.now())

            val own = lootCountsFor(listOf(partyId), weekOf20Jul)[partyId]!!
            assertEquals(1, own.pending)
            assertEquals(1, own.awaitingPayout)

            // Both are work still to do, and a drop that owes somebody money must not fall off the
            // list that shows it just because a Thursday went past.
            val next = lootCountsFor(listOf(partyId), weekAfter20Jul)[partyId]!!
            assertEquals(1, next.pending)
            assertEquals(1, next.awaitingPayout)
        }
    }

    @Test
    fun `nothing carries backwards into a week before the drop fell`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            addGrindstone(party)

            // Stepping back must not import a later week's pool, or a week that was quiet reads as
            // one that was not.
            val earlier = lootCountsFor(listOf(partyId), LocalDate.parse("2026-07-09"))[partyId]!!
            assertEquals(0, earlier.pending)
            assertEquals(0, earlier.awaitingPayout)
            assertEquals(0, earlier.settled)
        }
    }

    @Test
    fun `the list defaults to this week and the party's own page does not`() {
        transaction {
            val party = trio()
            val partyId = Uuid.parse(party.id)
            val seller = party.members.first { it.name == "Rune" }
            // Far enough back to be several weeks ago whenever this runs.
            val old = addGrindstoneOn(party, todayUtc().minus(60, DateTimeUnit.DAY))
            sellLoot(old, sale(seller.id), Uuid.parse(seller.id), partyId, Clock.System.now())
            settle(old, partyId)

            assertEquals(0, partiesFor(userId).single { it.id == party.id }.settledLoot)
            // Still reachable where it can be corrected or re-split.
            assertEquals(1, findParty(partyId, userId)!!.settledLoot)
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
