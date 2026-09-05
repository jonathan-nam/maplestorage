package com.sharpeyes.backend.parties

import com.sharpeyes.backend.config.Env
import com.sharpeyes.backend.db.BossCatalog
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyLoot
import com.sharpeyes.backend.db.PartyLootPayout
import com.sharpeyes.backend.db.PartyMember
import com.sharpeyes.backend.db.Person
import com.sharpeyes.backend.db.SettlementDebt
import com.sharpeyes.backend.db.SettlementDebtPayout
import com.sharpeyes.backend.db.Users
import com.sharpeyes.backend.users.ensureUser
import kotlinx.datetime.LocalDate
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
import kotlin.test.assertIs
import kotlin.test.assertTrue
import kotlin.time.Clock
import kotlin.uuid.Uuid

/**
 * V57's act as ONE write, against a real Postgres.
 *
 * An offset has two halves that cancel: the settle takes the share out of the net and the entry puts
 * it back. Written as two requests, the ledger between them said the shares were paid and nothing
 * had come off the debt, which is the debt un-offset, and a failure in the gap left it that way for
 * good. So the claim worth a database is that the halves land together or neither lands.
 */
class SettlementOffsetDbTest {
    private val userId = "user_test_offset_1"
    private val strangerId = "user_test_offset_2"

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
        val owners = listOf(userId, strangerId)
        transaction {
            // A party hangs off a character, and its members, loot and payout rows hang off it.
            Characters.deleteWhere { Characters.userId inList owners }
            SettlementDebt.deleteWhere { SettlementDebt.userId inList owners }
            Person.deleteWhere { Person.userId inList owners }
            Users.deleteWhere { Users.id inList owners }
        }
    }

    private fun person(
        owner: String,
        name: String,
    ): Uuid {
        val id = Uuid.random()
        val now = Clock.System.now()
        Person.insert {
            it[Person.id] = id
            it[userId] = owner
            it[Person.name] = name
            it[createdAt] = now
            it[updatedAt] = now
        }
        return id
    }

    /** One sold night with `seats` unpaid payout rows on it, which is what an offset discharges. */
    private fun nightOwing(
        owner: String,
        seats: Int,
    ): Pair<Uuid, List<Uuid>> {
        val now = Clock.System.now()
        val characterId = Uuid.random()
        Characters.insert {
            it[id] = characterId
            it[userId] = owner
            it[name] = "Splitter"
            it[worldType] = "INTERACTIVE"
            it[position] = 0
            it[createdAt] = now
            it[updatedAt] = now
        }
        // Any seeded boss: this is about the payout rows, not about which boss they came off.
        val boss = BossCatalog.selectAll().limit(1).single()[BossCatalog.id]
        val partyId = Uuid.random()
        Party.insert {
            it[id] = partyId
            it[userId] = owner
            it[Party.characterId] = characterId
            it[bossCatalogId] = boss
            it[createdAt] = now
            it[updatedAt] = now
        }
        val lootId = Uuid.random()
        PartyLoot.insert {
            it[id] = lootId
            it[PartyLoot.partyId] = partyId
            it[customName] = "Grindstone of Faith"
            it[droppedOn] = LocalDate(2026, 8, 28)
            it[quantity] = 1
            it[createdAt] = now
            it[updatedAt] = now
        }
        val members =
            (0 until seats).map { seat ->
                val memberId = Uuid.random()
                PartyMember.insert {
                    it[id] = memberId
                    it[PartyMember.partyId] = partyId
                    it[name] = "Bro$seat"
                    it[position] = seat
                    it[standing] = true
                    it[shares] = 1
                }
                PartyLootPayout.insert {
                    it[PartyLootPayout.lootId] = lootId
                    it[PartyLootPayout.memberId] = memberId
                    it[paid] = false
                    it[shares] = 1
                }
                memberId
            }
        return lootId to members
    }

    /** How many of a night's payout rows are marked paid. */
    private fun paidRows(lootId: Uuid): Int =
        PartyLootPayout
            .selectAll()
            .where { (PartyLootPayout.lootId eq lootId) and (PartyLootPayout.paid eq true) }
            .count()
            .toInt()

    private fun holderFor(personId: Uuid) =
        VestigeHolder(kind = "PERSON", personId = personId.toString(), characterName = null)

    @Test
    fun `settles the shares and records their entries in one write`() {
        val answer =
            transaction {
                ensureUser(userId, "offset@example.com")
                val bro = person(userId, "Bro")
                val (lootId, members) = nightOwing(userId, seats = 2)
                val result =
                    writeOffset(
                        userId,
                        holderFor(bro),
                        "offset against Bro",
                        listOf(
                            OffsetPart(lootId, members[0], 703_703_488),
                            OffsetPart(lootId, members[1], 139_548_023),
                        ),
                        Clock.System.now(),
                    )
                assertIs<OffsetWrite.Wrote>(result)
                // Both halves, read back inside the same transaction that wrote them.
                assertEquals(2, paidRows(lootId))
                result.answer
            }

        // ONE ROW PER SHARE, each negative and each naming the share it discharged: an offset over
        // two nights used to be one entry reading 843,251,511 and naming neither. See #514.
        assertEquals(listOf(-703_703_488L, -139_548_023L).sorted(), answer.debts.map { it.amount }.sorted())
        assertTrue(answer.debts.all { it.payouts.size == 1 })
        assertEquals(setOf("offset against Bro"), answer.debts.map { it.note }.toSet())
        // The pools come back with it, because the act moved them too: a second request for them is
        // the repaint this endpoint exists to remove.
        assertTrue(answer.pools.isNotEmpty())
    }

    @Test
    fun `a refused offset leaves neither half behind`() {
        // The failure the two requests could not rule out. The settle landed, the entry behind it was
        // refused, and what was left said the shares were paid with nothing off the debt: the debt
        // un-offset, and plausible. One transaction cannot end there.
        transaction {
            ensureUser(userId, "offset@example.com")
            val bro = person(userId, "Bro")
            val (lootId, members) = nightOwing(userId, seats = 2)

            // The second share is already discharged by an earlier entry, which is what a retry of a
            // half-finished offset looks like.
            val earlier = Uuid.random()
            val now = Clock.System.now()
            // Aliased, because inside the insert the table's own `userId` column shadows the
            // property: assigning it renders the column as the VALUE, and Postgres refuses it.
            val owner = userId
            SettlementDebt.insert {
                it[SettlementDebt.id] = earlier
                it[SettlementDebt.userId] = owner
                it[SettlementDebt.holderKind] = "PERSON"
                it[SettlementDebt.personId] = bro
                it[SettlementDebt.characterName] = null
                it[SettlementDebt.amount] = -139_548_023
                it[SettlementDebt.note] = "offset against Bro"
                it[SettlementDebt.incurredAt] = now
                it[SettlementDebt.createdAt] = now
            }
            SettlementDebtPayout.insert {
                it[debtId] = earlier
                it[SettlementDebtPayout.lootId] = lootId
                it[memberId] = members[1]
            }

            val result =
                writeOffset(
                    userId,
                    holderFor(bro),
                    "offset against Bro",
                    listOf(
                        OffsetPart(lootId, members[0], 703_703_488),
                        OffsetPart(lootId, members[1], 139_548_023),
                    ),
                    now,
                )
            assertIs<OffsetWrite.AlreadyDischarged>(result)
            // Neither half: the first share is not settled either, though nothing was wrong with it.
            assertEquals(0, paidRows(lootId))
            assertEquals(1, debtsFor(userId).size)
        }
    }

    @Test
    fun `a night in somebody else's party settles nothing and records nothing`() {
        transaction {
            ensureUser(userId, "offset@example.com")
            ensureUser(strangerId, "stranger@example.com")
            val (lootId, members) = nightOwing(strangerId, seats = 1)

            val result =
                writeOffset(
                    userId,
                    VestigeHolder(kind = "CHARACTER", personId = null, characterName = "bro"),
                    "offset against bro",
                    listOf(OffsetPart(lootId, members[0], 703_703_488)),
                    Clock.System.now(),
                )
            assertIs<OffsetWrite.Unreachable>(result)
            assertEquals(0, paidRows(lootId))
            assertTrue(debtsFor(userId).isEmpty())
        }
    }
}
