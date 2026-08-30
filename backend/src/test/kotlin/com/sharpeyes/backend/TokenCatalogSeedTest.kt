package com.sharpeyes.backend

import com.sharpeyes.backend.config.Env
import com.sharpeyes.backend.db.RedemptionRule
import com.sharpeyes.backend.db.TokenCatalog
import org.flywaydb.core.Flyway
import org.jetbrains.exposed.v1.jdbc.Database
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

// Exercises the real Flyway + Exposed path against a real Postgres (DB_* env vars. Same
// contract as docker-compose.yml locally and the postgres service in backend-verify.yml's
// CI job), which also serves as an implicit "migrations actually apply cleanly" check on
// every run. Automates PLAN.md's "after M1" verification bullet.
//
// This test used to assert `EXPECTED_TOKEN_COUNT = 6`. Adding the elixirs took the catalog
// to 13 and it failed. Correctly, but for the wrong reason: it was pinning a number, not
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

        // An icon is not universal any more: an item the pinned dataset does not carry and nobody
        // has cut art for is drawn as an empty slot, which is honest, and is what the drop side has
        // always done. So the claim is checked against the manifest rather than assumed: a filename
        // pointing at nothing is a broken image, and a missing one where art was declared is a bug.
        val withArt = manifestKeysWithArt()
        rows.forEach { row ->
            val key = row[TokenCatalog.visionKey]
            assertEquals(
                key in withArt,
                row[TokenCatalog.iconRefKey] != null,
                "icon_ref_key disagrees with catalog/items.yaml for $key",
            )
        }
    }

    /**
     * The keys whose manifest entry claims a picture: an `icon_id` to download, or `art: cut`.
     *
     * Read by line, like manifestKeys above and for the same reason: the backend has no YAML parser
     * and pulling one in for a file whose only shape here is two keys under a `- key:` would be a
     * dependency to keep in step with nothing.
     */
    private fun manifestKeysWithArt(): Set<String> {
        val keyed = Regex("""^\s*-\s*key:\s*(\S+)""")
        val claims = Regex("""^\s*(icon_id:\s*\d+|art:\s*cut)\s*$""")
        val out = mutableSetOf<String>()
        var current: String? = null
        File("../catalog/items.yaml").readLines().forEach { line ->
            keyed.find(line)?.let { current = it.groupValues[1] }
            if (claims.containsMatchIn(line)) current?.let { out.add(it) }
        }
        return out
    }

    // What the UI searches and counts on. All three were shipped empty at least once, the field
    // was added, the code compiled, and the running service kept serving the old shape, so every
    // slot search ("helm", "robe") silently found nothing.
    @Test
    fun `every redemption token says which boss it comes from and which pieces it buys`() {
        val jdbcUrl = "jdbc:postgresql://${Env.dbHost}:${Env.dbPort}/${Env.dbName}"
        Flyway
            .configure()
            .dataSource(jdbcUrl, Env.dbUsername, Env.dbPassword)
            .load()
            .migrate()
        Database.connect(jdbcUrl, "org.postgresql.Driver", Env.dbUsername, Env.dbPassword)

        transaction {
            TokenCatalog.selectAll().forEach { row ->
                val key = row[TokenCatalog.visionKey]
                assertTrue(row[TokenCatalog.itemGroup] != null, "$key has no item_group")
                assertTrue(row[TokenCatalog.sortOrder] != null, "$key has no sort_order")
                assertTrue(row[TokenCatalog.sourceBossName] != null, "$key has no source_boss_name")
            }

            RedemptionRule
                .innerJoin(TokenCatalog)
                .selectAll()
                .forEach { row ->
                    val key = row[TokenCatalog.visionKey]
                    val slots = row[RedemptionRule.slotGroup]
                    assertTrue(slots.isNotEmpty(), "$key is redeemable but buys nothing")
                    // The two sets are disjoint and must stay that way: a token that appeared in
                    // both would let a piece-set silently split in two.
                    assertTrue(
                        slots.toSet() == setOf("Hat", "Top", "Bottom", "Shoulder") ||
                            slots.toSet() == setOf("Cape", "Glove", "Shoe"),
                        "$key buys an unexpected set: $slots",
                    )
                }
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

        // Every Eternal piece is collected and traded in. The elixirs and potions are drunk: no
        // rule, and therefore no threshold for the UI to invent progress against.
        //
        // Eleven, not six. Jupiter's token joined the seven, and so did the four FRAGMENTS, which
        // are half a piece each: twenty of one buy the same armour that ten of its token do, and
        // that ratio is the threshold rather than a second concept. They could not be items at all
        // until a vision template stopped being required.
        val expected =
            setOf(
                "blissful-fantasy-shard",
                "distorted-ambition",
                "echo-ancient-resolve",
                "ferocious-beast-ring",
                "kalos-token",
                "trace-eternal-loyalty",
                "lingering-twisted-desire",
                "blissful-fantasy-fragment",
                "ferocious-entanglement-ring-fragment",
                "kalos-residual-determination-fragment",
                "whisper-ancient-resolve",
            )
        assertEquals(expected, ruled)
        assertTrue(all.size > ruled.size, "the catalog should hold consumables too")
    }
}
