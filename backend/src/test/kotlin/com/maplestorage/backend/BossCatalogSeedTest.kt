package com.maplestorage.backend

import com.maplestorage.backend.config.Env
import com.maplestorage.backend.db.BossCatalog
import org.flywaydb.core.Flyway
import org.jetbrains.exposed.v1.jdbc.Database
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import java.io.File
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

// The boss analogue of TokenCatalogSeedTest, and for the same reason: it compares the database
// against catalog/bosses.yaml rather than pinning a count, so adding a boss is still a one-file
// change and a boss that reaches only one of the two places fails here.
class BossCatalogSeedTest {
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

    // Tracked bosses only. An untracked entry (the dailies) is listed in the manifest so the
    // planner reader can still name its row, but it is seeded into no table, so counting it here
    // would assert the catalog holds a boss the tracker deliberately dropped.
    private fun manifestKeys(): List<String> {
        val manifest = File("../catalog/bosses.yaml")
        assertTrue(manifest.exists(), "catalog/bosses.yaml not found at ${manifest.absolutePath}")
        val keys = mutableListOf<String>()
        for (line in manifest.readLines()) {
            Regex("""^\s*-\s*key:\s*(\S+)""").find(line)?.let { keys.add(it.groupValues[1]) }
            if (Regex("""^\s*tracked:\s*false\b""").containsMatchIn(line)) keys.removeLastOrNull()
        }
        return keys
    }

    @Test
    fun `the boss catalog holds exactly what the manifest declares`() {
        val seeded = transaction { BossCatalog.selectAll().map { it[BossCatalog.bossKey] }.toSet() }
        assertEquals(manifestKeys().toSet(), seeded, "the seeded boss catalog and catalog/bosses.yaml disagree")
    }

    @Test
    fun `sort order reproduces the manifest's progression order`() {
        // Not merely "sort_order is set": the ORDER itself is the claim, because it is what the
        // clear matrix draws its columns in and nothing else in the schema encodes it. Sorted by
        // the column, the keys must come back in the order bosses.yaml lists them.
        val ordered =
            transaction {
                BossCatalog
                    .selectAll()
                    .orderBy(BossCatalog.sortOrder)
                    .map { it[BossCatalog.bossKey] }
            }
        assertEquals(manifestKeys(), ordered)
    }

    @Test
    fun `every boss declares a cadence the period logic understands`() {
        // reset is CHECK-constrained in the schema, but the constraint and BossPeriod's `when` are
        // two separate lists. A cadence that satisfied the database and not the code would throw
        // at ingestion time, on a real upload, rather than here.
        transaction {
            BossCatalog.selectAll().forEach { row ->
                val reset = row[BossCatalog.reset]
                assertTrue(
                    reset in com.maplestorage.backend.bosses.RESET_CADENCES,
                    "${row[BossCatalog.bossKey]} has cadence '$reset', which BossPeriod cannot resolve",
                )
                assertTrue(row[BossCatalog.sortOrder] != null, "${row[BossCatalog.bossKey]} has no sort_order")
            }
        }
    }
}
