package com.sharpeyes.backend

import com.sharpeyes.backend.bosses.dropTables
import com.sharpeyes.backend.config.Env
import com.sharpeyes.backend.db.BossCatalog
import com.sharpeyes.backend.db.BossDropAmount
import com.sharpeyes.backend.db.DropCatalog
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
 * Every number here was verified by hand against the game, one difficulty at a time, and they fill
 * the count when a drop is logged. That makes them the kind this repo is most afraid of: a number
 * nobody re-checks because the box was already filled in. So the WHOLE grid is pinned, keyed by
 * (boss, drop, difficulty, world), and compared as one map. A missing row fails as loudly as a
 * wrong one, which a spot check of a few figures would not.
 *
 * The world is not decoration. Chaos Kalos gives 5 pieces to the whole party on Interactive and 2
 * to EACH member on Heroic, and Extreme 14 against 3, so neither world can be derived from the
 * other. Extreme Kaling lands on 18 either way, which is exactly the coincidence that would let a
 * wrong derivation rule look correct.
 */
class BossDropAmountSeedTest {
    /** boss -> drop -> difficulty -> world -> pieces. Mirrors catalog/drops.yaml, by hand. */
    private val expected =
        mapOf(
            // --- Vestige coupons. One number each, and an INTERACTIVE one: it is the size of the
            // pile the party shares, and Reboot instances its pieces instead of piling them.
            "chosen-seren" to
                mapOf("vestige-of-erion" to mapOf("EXTREME" to pooled(30))),
            "limbo" to
                mapOf(
                    "vestige-of-erion" to mapOf("HARD" to pooled(60)),
                    // Instanced in both worlds AND the same count in both, which is why it is a bare
                    // number in the manifest where Kalos needs one per world. No fragment tier:
                    // Normal drops the piece itself.
                    "distorted-ambition" to
                        mapOf("NORMAL" to bothWorlds(1), "HARD" to bothWorlds(2)),
                ),
            "kalos-the-guardian" to
                mapOf(
                    "vestige-of-erion" to mapOf("EXTREME" to pooled(180)),
                    "kalos-token" to
                        mapOf("CHAOS" to perWorld(5, 2), "EXTREME" to perWorld(14, 3)),
                    "kalos-residual-determination-fragment" to
                        mapOf("NORMAL" to perWorld(3, 2)),
                ),
            "kaling" to
                mapOf(
                    "vestige-of-erion" to
                        mapOf("HARD" to pooled(60), "EXTREME" to pooled(480)),
                    "ferocious-beast-ring" to
                        mapOf("HARD" to perWorld(7, 2), "EXTREME" to perWorld(18, 3)),
                    // Easy still drops one here, where Easy Kalos drops nothing at all. The two
                    // ladders are not one rule, so neither may be copied onto the other.
                    "ferocious-entanglement-ring-fragment" to
                        mapOf("EASY" to bothWorlds(1), "NORMAL" to perWorld(5, 2)),
                ),
            "first-adversary" to
                mapOf(
                    "vestige-of-erion" to
                        mapOf("HARD" to pooled(30), "EXTREME" to pooled(240)),
                    "echo-ancient-resolve" to
                        mapOf("HARD" to perWorld(6, 2), "EXTREME" to perWorld(16, 3)),
                    "whisper-ancient-resolve" to mapOf("NORMAL" to perWorld(4, 2)),
                ),
            "malefic-star" to
                mapOf(
                    "vestige-of-erion" to mapOf("HARD" to pooled(90)),
                    "blissful-fantasy-shard" to mapOf("HARD" to perWorld(18, 2)),
                    "blissful-fantasy-fragment" to mapOf("NORMAL" to perWorld(6, 2)),
                ),
            "baldrix" to
                mapOf(
                    "vestige-of-erion" to mapOf("HARD" to pooled(120)),
                    "trace-eternal-loyalty" to
                        mapOf("NORMAL" to bothWorlds(1), "HARD" to bothWorlds(2)),
                ),
            "jupiter" to
                mapOf(
                    "vestige-of-erion" to
                        mapOf("NORMAL" to pooled(45), "HARD" to pooled(360)),
                    "lingering-twisted-desire" to
                        mapOf("NORMAL" to bothWorlds(1), "HARD" to bothWorlds(2)),
                ),
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
                    .map {
                        Row(
                            boss = it[BossCatalog.bossKey],
                            drop = it[DropCatalog.dropKey],
                            difficulty = it[BossDropAmount.difficulty],
                            world = it[BossDropAmount.world],
                            pieces = it[BossDropAmount.pieces],
                        )
                    }
            }
        val actual =
            seeded
                .groupBy { it.boss }
                .mapValues { (_, ofBoss) ->
                    ofBoss.groupBy { it.drop }.mapValues { (_, ofDrop) ->
                        ofDrop.groupBy { it.difficulty }.mapValues { (_, ofMode) ->
                            ofMode.associate { it.world to it.pieces }
                        }
                    }
                }
        assertEquals(expected, actual, "the seeded amounts and catalog/drops.yaml disagree")
    }

    @Test
    fun `a difficulty that drops none has no row at all`() {
        // Easy Kalos and Easy First Adversary drop no pieces, which catalog/drops.yaml states as a
        // 0. It reaches the database as an ABSENT row, not a zero: nothing to fill is what an empty
        // box already says, and a pre-filled zero would be a claim the drop table does not make.
        //
        // Pinned rather than left to the grid above, because "no row" is the fact that would rot
        // silently: an Easy row appearing later reads as a boss that started dropping pieces.
        val kalos = transaction { dropTables()["kalos-the-guardian"] }.orEmpty()
        val token = kalos.single { it.dropKey == "kalos-token" }

        assertNull(token.pieces["INTERACTIVE"]?.get("EASY"))
        assertNull(token.pieces["HEROIC"]?.get("EASY"))
        // And the mode above it is there, so the absence above is the count and not a broken read.
        assertEquals(5, token.pieces["INTERACTIVE"]?.get("CHAOS"))
    }

    @Test
    fun `the drop table carries them per world, which is what fills the count`() {
        val kalos = transaction { dropTables()["kalos-the-guardian"] }.orEmpty()
        val vestige = kalos.single { it.dropKey == "vestige-of-erion" }
        assertEquals(mapOf("EXTREME" to 180), vestige.pieces["INTERACTIVE"])
        // Nothing for Heroic, because 180 is the size of a PILE and Reboot instances its pieces.
        // Seeded to both worlds, this figure had a Heroic party dividing coupons all six already
        // held. Absent fills nothing, which is the honest answer until somebody counts the real one.
        assertNull(vestige.pieces["HEROIC"])

        // A difficulty that drops none is ABSENT rather than zero, so the box fills nothing instead
        // of claiming the boss drops none at Chaos.
        assertNull(vestige.pieces["INTERACTIVE"]?.get("CHAOS"))

        // And a drop with no amounts at all is untouched by the join, rather than losing its row.
        assertEquals(emptyMap(), kalos.single { it.dropKey == "grindstone-of-life" }.pieces)
    }

    @Test
    fun `every drop with a Heroic count says it is instanced there`() {
        // Reboot hands each member their own pieces, so a Heroic figure is a count PER PERSON. A
        // drop carrying one without saying `per_member` is claiming Reboot pools it, and the Drop
        // Log divides whatever it finds: that is how a Heroic Kalos night was told its share of 180
        // coupons the party never held. build.py refuses the pair now; this is the seeded proof, so
        // a hand-edited R__ file cannot reintroduce it either.
        val offenders =
            transaction {
                dropTables().flatMap { (boss, drops) ->
                    drops
                        .filter { it.pieces["HEROIC"].orEmpty().isNotEmpty() }
                        .filter { it.perMember != "HEROIC" && it.perMember != "ALWAYS" }
                        .map { "$boss/${it.dropKey}" }
                }
            }

        assertEquals(emptyList(), offenders.sorted())
    }

    @Test
    fun `the vestige coupon is instanced in Heroic, like every other piece`() {
        // It was the one piece drop in the manifest not saying so. The control below is a drop that
        // is pooled in BOTH worlds, so this cannot pass by every drop having become per-member.
        val limbo = transaction { dropTables()["limbo"] }.orEmpty()

        assertEquals("HEROIC", limbo.single { it.dropKey == "vestige-of-erion" }.perMember)
        assertNull(limbo.single { it.dropKey == "grindstone-of-life" }.perMember)
    }

    @Test
    fun `an Eternal piece is untradeable and a coupon is not`() {
        // What keeps a piece out of the tranche ledger and out of any settlement. Seeded from the
        // manifest, so this fails if an `item:` entry loses the flag. See V62.
        val kalos = transaction { dropTables()["kalos-the-guardian"] }.orEmpty()

        assertEquals(true, kalos.single { it.dropKey == "kalos-token" }.untradeable)
        assertEquals(
            true,
            kalos.single { it.dropKey == "kalos-residual-determination-fragment" }.untradeable,
        )
        assertEquals(false, kalos.single { it.dropKey == "vestige-of-erion" }.untradeable)
    }

    @Test
    fun `a token is usually one to a stack, so the drop divides down to the single piece`() {
        // Derived from the count by build.py rather than written, which is why it is checked here: a
        // party that cannot divide 5 pieces six ways hands the odd one to whoever is next, and that
        // is only possible because no stack has to move whole.
        val kalos = transaction { dropTables()["kalos-the-guardian"] }.orEmpty()
        val token = kalos.single { it.dropKey == "kalos-token" }

        assertEquals(token.pieces["INTERACTIVE"], token.bundles["INTERACTIVE"])
        assertEquals(token.pieces["HEROIC"], token.bundles["HEROIC"])
    }

    @Test
    fun `Hard Malefic Star is the piece that falls in stacks of three`() {
        // The exception, and the reason `count` can state a bundling apart from the total. 18 in 6
        // stacks is what a party divides by, so four people cannot take four and a half pieces each:
        // they are moving stacks that will not cut. Seeded as 18 in 18 for a day, which said the
        // opposite.
        val star = transaction { dropTables()["malefic-star"] }.orEmpty()
        val shard = star.single { it.dropKey == "blissful-fantasy-shard" }

        assertEquals(18, shard.pieces["INTERACTIVE"]?.get("HARD"))
        assertEquals(6, shard.bundles["INTERACTIVE"]?.get("HARD"))
        // Heroic gives 2 EACH, so there is nothing to divide and the bundling says nothing.
        assertEquals(2, shard.pieces["HEROIC"]?.get("HARD"))
    }

    private data class Row(
        val boss: String,
        val drop: String,
        val difficulty: String,
        val world: String,
        val pieces: Int,
    )

    private companion object {
        /**
         * A count the manifest states once, for a drop instanced in both worlds, so both carry it.
         *
         * Only legal on a per_member drop. An instanced count is per PERSON, so stating it once is
         * saying the two worlds hand out the same number each, which Limbo and Baldrix do.
         */
        fun bothWorlds(pieces: Int) = mapOf("INTERACTIVE" to pieces, "HEROIC" to pieces)

        /**
         * The size of a POOL, which only Interactive has.
         *
         * Reboot instances every piece it drops, so there is no pile there for a pooled figure to
         * be the size of. These used to be written to both worlds, and the Drop Log divided the
         * Heroic copy: a Heroic Kalos night was told its share of 180 coupons the party never held
         * as 180. However many Reboot hands each member, it is not this number, so nothing is
         * seeded for it and the count is left for whoever logs the drop.
         */
        fun pooled(pieces: Int) = mapOf("INTERACTIVE" to pieces)

        /** Two independent counts. Interactive first, matching the manifest's own order. */
        fun perWorld(
            interactive: Int,
            heroic: Int,
        ) = mapOf("INTERACTIVE" to interactive, "HEROIC" to heroic)
    }
}
