package com.maplestorage.backend

import com.maplestorage.backend.config.Env
import com.maplestorage.backend.db.RedemptionRule
import com.maplestorage.backend.db.TokenCatalog
import org.flywaydb.core.Flyway
import org.jetbrains.exposed.v1.jdbc.Database
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

// Exercises the real Flyway + Exposed path against a real Postgres (DB_* env vars -- same
// contract as docker-compose.yml locally and the postgres service in backend-verify.yml's
// CI job), which also serves as an implicit "migrations actually apply cleanly" check on
// every run. Automates PLAN.md's "after M1" verification bullet.
//
// This test used to assert `EXPECTED_TOKEN_COUNT = 6`. Adding the elixirs took the catalog
// to 13 and it failed -- correctly, but for the wrong reason: it was pinning a number, not
// a property. A hardcoded count is the same mistake that made load_templates() throw
// "templates missing" while thirteen templates sat on disk.
//
// The property that actually matters is that the database agrees with catalog/items.yaml,
// which is the source of truth. So count the manifest rather than remembering a number.
class TokenCatalogSeedTest {
    private fun manifestKeys(): Set<String> {
        // ../catalog/items.yaml, from backend/. A one-line parse beats a YAML dependency
        // for a file whose only shape here is "  - key: something".
        val manifest = File("../catalog/items.yaml")
        assertTrue(manifest.exists(), "catalog/items.yaml not found at ${manifest.absolutePath}")
        return manifest
            .readLines()
            .mapNotNull { Regex("""^\s*-\s*key:\s*(\S+)""").find(it)?.groupValues?.get(1) }
            .toSet()
    }

    @Test
    fun `the catalog holds exactly what the manifest declares`() {
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

        val rows = transaction { TokenCatalog.selectAll().toList() }
        val seeded = rows.map { it[TokenCatalog.visionKey] }.toSet()
        val declared = manifestKeys()

        assertEquals(declared, seeded, "the seeded catalog and catalog/items.yaml disagree")

        rows.forEach { row ->
            assertTrue(
                row[TokenCatalog.iconRefKey] != null,
                "Expected iconRefKey to be set for ${row[TokenCatalog.name]}",
            )
        }
    }

    @Test
    fun `only redemption tokens have a redemption rule`() {
        val jdbcUrl = "jdbc:postgresql://${Env.dbHost}:${Env.dbPort}/${Env.dbName}"
        Flyway
            .configure()
            .dataSource(jdbcUrl, Env.dbUsername, Env.dbPassword)
            .load()
            .migrate()
        Database.connect(jdbcUrl, "org.postgresql.Driver", Env.dbUsername, Env.dbPassword)

        val (ruled, all) =
            transaction {
                val byId = TokenCatalog.selectAll().associate { it[TokenCatalog.id] to it[TokenCatalog.visionKey] }
                val ruled = RedemptionRule.selectAll().map { byId[it[RedemptionRule.itemId]]!! }.toSet()
                ruled to byId.values.toSet()
            }

        // The six boss tokens are collected and traded in. The elixirs and potions are drunk:
        // no rule, and therefore no threshold for the UI to invent progress against.
        val expected =
            setOf(
                "blissful-fantasy-shard",
                "distorted-ambition",
                "echo-ancient-resolve",
                "ferocious-beast-ring",
                "kalos-token",
                "trace-eternal-loyalty",
            )
        assertEquals(expected, ruled)
        assertTrue(all.size > ruled.size, "the catalog should hold consumables too")
    }
}
