package com.maplestorage.backend.bosses

import com.maplestorage.backend.db.BossCatalog
import com.maplestorage.backend.db.BossDrop
import com.maplestorage.backend.db.BossDropAmount
import com.maplestorage.backend.db.DropCatalog
import kotlinx.serialization.Serializable
import org.jetbrains.exposed.v1.jdbc.selectAll

// What each boss can drop, seeded from catalog/drops.yaml. Mirrored by the frontend's
// types/drop.ts field-for-field.

@Serializable
data class BossDropResponse(
    val dropKey: String,
    val name: String,
    // Backend-relative, resolved by apiAssetUrl(). Null for a drop with no official art, which
    // the client draws as a blank slot rather than a broken image.
    val iconUrl: String?,
    // ALWAYS or HEROIC when every member gets their own copy, null when the party gets one. The
    // loot pool warns on it: a per-member drop split six ways pays everyone a sixth of what they
    // already hold, which is the pooling-what-cannot-be-pooled mistake this app has made before.
    val perMember: String?,
    // INTERACTIVE for the coupons that do not drop in Reboot. Null means everywhere.
    val worlds: String?,
    val quantity: Int,
    /**
     * How many pieces this boss drops of it, by difficulty, for the count to be filled in with.
     *
     * Only the difficulties that drop any are in here. An absent one means nothing to fill, which is
     * not the same as none: a pre-filled zero would be a claim the drop table does not make.
     */
    val pieces: Map<String, Int> = emptyMap(),
)

/**
 * Every boss's drop table, keyed by boss key.
 *
 * One query for the lot rather than one per boss: the whole catalog is a few dozen rows, and the
 * client needs the table for whichever boss the user picks next. Must run inside a transaction.
 */
internal fun dropTables(): Map<String, List<BossDropResponse>> {
    // One query for every amount, keyed the way the rows below need it. A join would multiply each
    // drop by its difficulties and the group-by would count one drop several times.
    val piecesFor =
        BossDropAmount
            .innerJoin(BossCatalog)
            .innerJoin(DropCatalog)
            .selectAll()
            .groupBy({ it[BossCatalog.bossKey] to it[DropCatalog.dropKey] }) {
                it[BossDropAmount.difficulty] to it[BossDropAmount.pieces]
            }.mapValues { (_, pairs) -> pairs.toMap() }

    return BossDrop
        .innerJoin(BossCatalog)
        .innerJoin(DropCatalog)
        .selectAll()
        .orderBy(BossCatalog.sortOrder to org.jetbrains.exposed.v1.core.SortOrder.ASC)
        .orderBy(BossDrop.sortOrder to org.jetbrains.exposed.v1.core.SortOrder.ASC)
        .groupBy({ it[BossCatalog.bossKey] }) { row ->
            BossDropResponse(
                dropKey = row[DropCatalog.dropKey],
                name = row[DropCatalog.name],
                iconUrl = row[DropCatalog.iconRefKey]?.let { "/drop-icons/$it" },
                perMember = row[DropCatalog.perMember],
                worlds = row[DropCatalog.worlds],
                quantity = row[DropCatalog.quantity],
                pieces = piecesFor[row[BossCatalog.bossKey] to row[DropCatalog.dropKey]].orEmpty(),
            )
        }
}
