package com.maplestorage.backend.parties

import com.maplestorage.backend.config.Env
import com.maplestorage.backend.db.Characters
import com.maplestorage.backend.db.Party
import com.maplestorage.backend.db.Person
import com.maplestorage.backend.db.Screenshots
import com.maplestorage.backend.db.VestigeSettlement
import com.maplestorage.backend.db.VestigeSettlementLoot
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
import kotlin.test.assertTrue
import kotlin.time.Clock
import kotlin.time.Instant
import kotlin.uuid.Uuid

/**
 * The drops a clear implies, against a real Postgres.
 *
 * Vestige coupons are guaranteed and the catalog knows the amount, so clearing the boss already says
 * they landed. What is worth a database to check is everything this must NOT do: file twice for one
 * period, file at a difficulty that drops none, file where nobody has said which difficulty, or take
 * back a row somebody has already sold.
 */
class LootFromClearTest {
    private val userId = "user_test_from_clear_1"
    private val today = LocalDate.parse("2026-08-08")

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
        val owners = listOf(userId)
        transaction {
            Party.deleteWhere { Party.userId inList owners }
            // After the pools, whose drops the closures point at. Nothing cascades the other way.
            VestigeSettlement.deleteWhere { VestigeSettlement.userId inList owners }
            Person.deleteWhere { Person.userId inList owners }
            Characters.deleteWhere { Characters.userId inList owners }
            Screenshots.deleteWhere { Screenshots.userId inList owners }
        }
    }

    /** One character of this account, which every case here runs something on. */
    private fun character(): Uuid {
        ensureUser(userId, "$userId@example.com")
        val mine = Uuid.random()
        val now = Clock.System.now()
        val owner = userId
        Characters.insert {
            it[Characters.id] = mine
            it[Characters.userId] = owner
            it[Characters.name] = "Husky"
            it[Characters.worldType] = WORLD_INTERACTIVE
            it[createdAt] = now
            it[updatedAt] = now
            it[position] = 0
        }
        return mine
    }

    /** A party on Extreme Kalos, which drops 180 coupons, unless [difficulty] says otherwise. */
    private fun party(
        difficulty: String? = "EXTREME",
        boss: String = "kalos-the-guardian",
        others: List<String> = listOf("Steve"),
        looterName: String? = null,
    ): Pair<Uuid, Uuid> {
        val mine = character()
        val now = Clock.System.now()
        val bossId = bossIdForKey(boss)!!
        val request =
            SavePartyRequest(
                mine.toString(),
                boss,
                others,
                difficulty = difficulty,
                looterName = looterName,
            )
        return mine to createParty(userId, mine, bossId, request, now)
    }

    private fun pool(partyId: Uuid) = lootFor(partyId)

    @Test
    fun `clearing a boss files what it guarantees, off the catalog's own count`() {
        transaction {
            val (characterId, partyId) = party()
            val bossId = bossIdForKey("kalos-the-guardian")!!

            lootFromClear(characterId, bossId, "WEEKLY", today, Clock.System.now())

            val row = pool(partyId).single()
            assertEquals("Vestige of Erion Coupon", row.name)
            // What FELL, which is what Extreme Kalos gives. Who gets how much of it is worked out
            // on every read, from the party as it stands. See V40.
            assertEquals(180, row.quantity)
            assertEquals("kalos-the-guardian", row.bossKey)
        }
    }

    @Test
    fun `the row is what fell, whoever ran and however many of them there were`() {
        transaction {
            // Hard Limbo drops 60. The row said 20 here once, this character's share of a trio,
            // and it kept saying 20 after the trio became a duo. A stored share does not follow the
            // party it was worked out from, so nothing stores one now: 60 fell, and 60 is the row.
            val (characterId, partyId) = party(difficulty = "HARD", boss = "limbo", others = listOf("Steve", "Bob"))
            lootFromClear(characterId, bossIdForKey("limbo")!!, "WEEKLY", today, Clock.System.now())
            assertEquals(60, pool(partyId).single().quantity)
        }
    }

    @Test
    fun `a duo files the same row as a trio, because the drop is the same drop`() {
        transaction {
            val (characterId, partyId) = party(difficulty = "HARD", boss = "limbo", others = listOf("Steve"))
            lootFromClear(characterId, bossIdForKey("limbo")!!, "WEEKLY", today, Clock.System.now())
            assertEquals(60, pool(partyId).single().quantity)
        }
    }

    @Test
    fun `a designated looter changes nothing about the row either`() {
        transaction {
            // The Husky arrangement: the partner loots and sells everything. That decides who OWES
            // whom, which the ledger reads off the config, and not what the boss dropped.
            val (characterId, partyId) =
                party(
                    difficulty = "HARD",
                    boss = "limbo",
                    others = listOf("Steve", "Bob"),
                    looterName = "Steve",
                )
            lootFromClear(characterId, bossIdForKey("limbo")!!, "WEEKLY", today, Clock.System.now())
            assertEquals(60, pool(partyId).single().quantity)
        }
    }

    @Test
    fun `re-ticking the same clear does not stack up a second row`() {
        transaction {
            val (characterId, partyId) = party()
            val bossId = bossIdForKey("kalos-the-guardian")!!
            val now = Clock.System.now()

            lootFromClear(characterId, bossId, "WEEKLY", today, now)
            lootFromClear(characterId, bossId, "WEEKLY", today, now)
            // Two days later in the same week, which is the same period and so the same 180.
            lootFromClear(characterId, bossId, "WEEKLY", LocalDate.parse("2026-08-10"), now)

            assertEquals(1, pool(partyId).size)
        }
    }

    @Test
    fun `says nothing where the amount is unknown`() {
        transaction {
            // Chaos Kalos drops none, and the catalog carries no row for it rather than a zero.
            val (chaosCharacter, chaosParty) = party(difficulty = "CHAOS")
            lootFromClear(
                chaosCharacter,
                bossIdForKey("kalos-the-guardian")!!,
                "WEEKLY",
                today,
                Clock.System.now(),
            )
            assertTrue(pool(chaosParty).isEmpty())
        }
        cleanUp()
        transaction {
            // And a config where nobody has said which difficulty cannot know which amount applies.
            val (quietCharacter, quietParty) = party(difficulty = null)
            lootFromClear(
                quietCharacter,
                bossIdForKey("kalos-the-guardian")!!,
                "WEEKLY",
                today,
                Clock.System.now(),
            )
            assertTrue(pool(quietParty).isEmpty())
        }
    }

    @Test
    fun `a boss run alone files the whole drop, because one seat took all of it`() {
        transaction {
            val characterId = character()
            val bossId = bossIdForKey("kalos-the-guardian")!!
            val partyId = setSoloDifficulty(userId, characterId, bossId, "WEEKLY", "EXTREME", Clock.System.now())!!

            lootFromClear(characterId, bossId, "WEEKLY", today, Clock.System.now())

            // 180, not a share of 180. There is one seat, so those are the same number here, and the
            // row is WHAT FELL either way. See V40.
            assertEquals(180, pool(partyId).single().quantity)
            assertTrue(findParty(partyId, userId)!!.solo)
        }
    }

    @Test
    fun `a boss run alone at no stated mode files nothing`() {
        transaction {
            // The reason this is asked for at all: Extreme Kalos gives 180 and Chaos Kalos none, and
            // a clear does not say which was killed. Guessing is the wrong count wearing a real name.
            val characterId = character()
            val bossId = bossIdForKey("kalos-the-guardian")!!
            val partyId = poolFor(userId, characterId, bossId, Clock.System.now())

            lootFromClear(characterId, bossId, "WEEKLY", today, Clock.System.now())

            assertTrue(pool(partyId).isEmpty())
        }
    }

    @Test
    fun `un-ticking takes back what the clear added, and leaves a sale alone`() {
        transaction {
            val (characterId, partyId) = party()
            val bossId = bossIdForKey("kalos-the-guardian")!!
            val now = Clock.System.now()

            lootFromClear(characterId, bossId, "WEEKLY", today, now)
            unlootFromClear(characterId, bossId, "WEEKLY", today)
            assertTrue(pool(partyId).isEmpty(), "a row the clear added and nobody touched goes with it")

            // Sold, and now the clear is un-ticked: that is money somebody is owed, and un-ticking a
            // clear says nothing about it.
            lootFromClear(characterId, bossId, "WEEKLY", today, now)
            val row = pool(partyId).single()
            val seller = findParty(partyId, userId)!!.members.first()
            sellLoot(
                Uuid.parse(row.id),
                SellLootRequest(4_420_000_000, "RECEIVED", "FAIR", seller.id),
                Uuid.parse(seller.id),
                partyId,
                now,
            )
            unlootFromClear(characterId, bossId, "WEEKLY", today)
            assertEquals(1, pool(partyId).size)
        }
    }

    @Test
    fun `un-ticking leaves a pile whose books have been closed`() {
        transaction {
            val (characterId, partyId) = party()
            val bossId = bossIdForKey("kalos-the-guardian")!!
            val now = Clock.System.now()
            lootFromClear(characterId, bossId, "WEEKLY", today, now)
            // Coupons never get a sold_at: they settle through the tranche ledger, so "unsold" says
            // nothing about whether anybody is finished with them. Closing the books is what does,
            // and the closure names this row, so deleting it would take the closure with it.
            closeBooks(Uuid.parse(pool(partyId).single().id), now)

            unlootFromClear(characterId, bossId, "WEEKLY", today)

            assertEquals(1, pool(partyId).size)
        }
    }

    /** One act of closing a holder's books over one drop, as VestigeSettlementRoutes writes it. */
    private fun closeBooks(
        lootId: Uuid,
        now: Instant,
    ) {
        val settlementId = Uuid.random()
        val owner = userId
        VestigeSettlement.insert {
            it[id] = settlementId
            it[VestigeSettlement.userId] = owner
            it[holderKind] = "SELF"
            it[unpaid] = 0
            it[settledAt] = now
            it[createdAt] = now
        }
        VestigeSettlementLoot.insert {
            it[VestigeSettlementLoot.settlementId] = settlementId
            it[VestigeSettlementLoot.lootId] = lootId
        }
    }

    @Test
    fun `a retired config collects nothing more, and a clear does not bring it back`() {
        transaction {
            val (characterId, partyId) = party()
            val bossId = bossIdForKey("kalos-the-guardian")!!
            val now = Clock.System.now()

            // A drop somebody LOGGED, so deleting the config retires it and keeps the pool. A
            // clear-filed row would not do here any more: deleting takes this period's tick back
            // and its coupons with it, and a config nothing else points at is deleted outright.
            // See withdrawClear.
            val logged =
                addLoot(partyId, LootedDrop(dropIdForKey("grindstone-of-faith")!!), bossId, today, now)
            assertEquals(Removal.RETIRED, retireOrDeleteParty(partyId, userId, now))

            // A later week, so it is the retirement stopping this and not the once-a-period rule.
            lootFromClear(characterId, bossId, "WEEKLY", LocalDate.parse("2026-08-15"), now)

            // addLoot revives whatever it inserts into, which is right for a drop somebody logged
            // and wrong for a clear: ticking the boss would un-delete the party as a side effect,
            // and its coupons would be split with a guest nobody said was there.
            assertEquals(
                listOf(logged.toString()),
                pool(partyId).map { it.id },
                "a config you deleted does not keep collecting",
            )
            assertTrue(findParty(partyId, userId)!!.retired)
            assertTrue(partiesFor(userId).none { it.id == partyId.toString() })
        }
    }

    @Test
    fun `a row filed into an earlier period is still the clear's to take back`() {
        transaction {
            val (characterId, partyId) = party()
            val bossId = bossIdForKey("kalos-the-guardian")!!
            val now = Clock.System.now()
            // A period that is over, which is the one deleting the config does not reach into.
            val backThen = LocalDate.parse("2026-07-25")

            lootFromClear(characterId, bossId, "WEEKLY", backThen, now)
            retireOrDeleteParty(partyId, userId, now)

            // Rows filed into a config before it was retired stay removable by the tick that put
            // them there, which is the only thing that may take them.
            assertEquals(1, pool(partyId).size)
            unlootFromClear(characterId, bossId, "WEEKLY", backThen)
            assertTrue(pool(partyId).isEmpty())
        }
    }

    @Test
    fun `a row a human logged is never taken back by a clear`() {
        transaction {
            val (characterId, partyId) = party()
            val bossId = bossIdForKey("kalos-the-guardian")!!
            val now = Clock.System.now()
            // Typed, not filed from a clear: they saw it fall, so the clear does not answer for it.
            addLoot(partyId, LootedDrop(dropIdForKey("vestige-of-erion")!!, quantity = 60), bossId, today, now)

            unlootFromClear(characterId, bossId, "WEEKLY", today)

            assertEquals(60, pool(partyId).single().quantity)
        }
    }
}
