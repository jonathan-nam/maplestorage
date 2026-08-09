package com.maplestorage.backend.parties

import com.maplestorage.backend.config.Env
import com.maplestorage.backend.db.Characters
import com.maplestorage.backend.db.Party
import com.maplestorage.backend.db.PartyMember
import com.maplestorage.backend.db.Person
import com.maplestorage.backend.db.Screenshots
import com.maplestorage.backend.users.WORLD_INTERACTIVE
import com.maplestorage.backend.users.ensureUser
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
import org.jetbrains.exposed.v1.jdbc.update
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.time.Clock
import kotlin.uuid.Uuid

/**
 * Which drops in a pool are still work, against a real Postgres.
 *
 * The claim worth a database: a drop that comes in pieces is settled through the tranche ledger and
 * never through a sale on its own row, so "not sold" says nothing about it. Reading it as pending
 * put every coupon drop the account had ever had into the pool, permanently, on parties whose split
 * came out exactly even. See LootPoolWork.kt.
 */
class PartyPoolWorkTest {
    private val userId = "user_test_pool_work"
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
        // Held in a local, for the reason PartyLootTest spells out: inside deleteWhere {} a bare
        // `userId` binds to the COLUMN and the predicate takes the whole table.
        val owners = listOf(userId)
        transaction {
            Party.deleteWhere { Party.userId inList owners }
            Person.deleteWhere { Person.userId inList owners }
            Characters.deleteWhere { Characters.userId inList owners }
            Screenshots.deleteWhere { Screenshots.userId inList owners }
        }
    }

    @Test
    fun `a coupon drop is only in the pool while somebody else is holding your share`() {
        transaction {
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
            // HARD, because whether a drop comes in pieces is per (boss, difficulty). A party with
            // no mode recorded matches no amount and is counted the ordinary way.
            val request =
                SavePartyRequest(mine.toString(), "limbo", listOf("Steve", "Bob"), difficulty = "HARD")
            val partyId = createParty(userId, mine, bossIdForKey("limbo")!!, request, now)
            addLoot(
                partyId,
                LootedDrop(dropIdForKey("vestige-of-erion")!!),
                bossIdForKey("limbo"),
                dropped,
                now,
            )

            val pending = { lootCountsFor(listOf(partyId), week = null)[partyId]!!.pending }
            val seat = { name: String ->
                PartyMember
                    .selectAll()
                    .where { (PartyMember.partyId eq partyId) and (PartyMember.name eq name) }
                    .first()[PartyMember.id]
            }

            // Nobody looted the lot, so the coupons went into the right inventories on the night.
            // This counted for ever before: a piece row never sells, so PENDING never stops.
            assertEquals(0, pending())

            // And it stays out however it was looted. What is left to do about a coupon drop is
            // said in COUPONS, on the party row, so counting the row as well is one fact twice:
            // a single drop read as "1 in the pool - 30 coupons owed".
            Party.update({ Party.id eq partyId }) { it[looterMemberId] = seat("Steve") }
            assertEquals(0, pending())

            Party.update({ Party.id eq partyId }) { it[looterMemberId] = seat("Rune") }
            assertEquals(0, pending())

            // And none of this touches an ordinary drop, which is work until it sells.
            addLoot(
                partyId,
                LootedDrop(dropIdForKey("grindstone-of-faith")!!),
                bossIdForKey("limbo"),
                dropped,
                now,
            )
            assertEquals(1, pending())
        }
    }
}
