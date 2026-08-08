package com.maplestorage.backend

import com.maplestorage.backend.bosses.dropTables
import com.maplestorage.backend.config.Env
import com.maplestorage.backend.db.BossCatalog
import com.maplestorage.backend.db.BossDropAmount
import com.maplestorage.backend.db.DropCatalog
import org.flywaydb.core.Flyway
import org.jetbrains.exposed.v1.jdbc.Database
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * How many pieces each boss drops, against a real Postgres.
 *
 * These eleven numbers were verified by hand against the game, one difficulty at a time, and they
 * fill the count when a drop is logged. That makes them the kind of number this repo is most afraid
 * of: one nobody re-checks because the box was already filled in. So they are pinned here, and a
 * build.py change that drops or renames a row fails rather than quietly filling nothing.
 */
class BossDropAmountSeedTest {
    private val expected =
        mapOf(
            "chosen-seren" to mapOf("EXTREME" to 30),
            "kalos-the-guardian" to mapOf("EXTREME" to 180),
            "kaling" to mapOf("HARD" to 60, "EXTREME" to 480),
            "limbo" to mapOf("HARD" to 60),
            "baldrix" to mapOf("HARD" to 120),
            "malefic-star" to mapOf("HARD" to 90),
            "first-adversary" to mapOf("HARD" to 30, "EXTREME" to 240),
            "jupiter" to mapOf("NORMAL" to 45, "HARD" to 360),
        )

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

    @Test
    fun `every verified amount is seeded, and nothing else is`() {
        val seeded =
            transaction {
                BossDropAmount
                    .innerJoin(BossCatalog)
                    .innerJoin(DropCatalog)
                    .selectAll()
                    .groupBy({ it[BossCatalog.bossKey] }) {
                        it[BossDropAmount.difficulty] to it[BossDropAmount.pieces]
                    }.mapValues { (_, pairs) -> pairs.toMap() }
            }
        assertEquals(expected, seeded, "the seeded amounts and catalog/drops.yaml disagree")
    }

    @Test
    fun `the drop table carries them, which is what fills the count`() {
        val kalos = transaction { dropTables()["kalos-the-guardian"] }.orEmpty()
        val vestige = kalos.single { it.dropKey == "vestige-of-erion" }
        assertEquals(mapOf("EXTREME" to 180), vestige.pieces)

        // A difficulty that drops none is ABSENT rather than zero, so the box fills nothing instead
        // of claiming the boss drops none at Chaos.
        assertNull(vestige.pieces["CHAOS"])

        // And a drop with no amounts at all is untouched by the join, rather than losing its row.
        assertEquals(emptyMap(), kalos.single { it.dropKey == "grindstone-of-life" }.pieces)
    }
}
