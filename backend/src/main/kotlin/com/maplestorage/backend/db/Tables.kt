package com.maplestorage.backend.db

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import org.jetbrains.exposed.v1.core.Table
import org.jetbrains.exposed.v1.datetime.date
import org.jetbrains.exposed.v1.datetime.timestamp
import org.jetbrains.exposed.v1.json.jsonb

// Column definitions mirror db/migration/V1__create_core_schema.sql column-for-column.
// Flyway owns the actual DDL (see that file); these Table objects exist purely so
// route/repository code gets compile-time-checked query building instead of raw SQL
// string literals. There is no SchemaUtils.create(...) call anywhere.

object Users : Table("users") {
    // Clerk userIds are strings (e.g. "user_2abc..."), not UUIDs.
    val id = text("id")
    val email = text("email")
    val createdAt = timestamp("created_at")

    override val primaryKey = PrimaryKey(id)
}

object Characters : Table("characters") {
    val id = uuid("id")
    val userId = reference("user_id", Users.id)
    val name = text("name")
    val level = integer("level").nullable()
    val jobName = text("job_name").nullable()
    val worldName = text("world_name").nullable()
    val spriteImgUrl = text("sprite_img_url").nullable()
    val spriteRefreshedAt = timestamp("sprite_refreshed_at").nullable()
    val createdAt = timestamp("created_at")
    val updatedAt = timestamp("updated_at")

    // The user's chosen order in the carousel, 0-based and dense per user (V11). Reads sort by it.
    val position = integer("position")

    override val primaryKey = PrimaryKey(id)
}

object TokenCatalog : Table("token_catalog") {
    // No auto-default. Rows are seeded by R__token_catalog.sql (generated from
    // catalog/items.yaml), which keeps an existing row's id across re-seeds, these ids are
    // referenced by character_token_count, so churning them would orphan every user's counts.
    val id = uuid("id")
    val name = text("name").uniqueIndex()

    // The key the screenshot parser identifies this token by (it is the name of
    // the template file in vision/app/cv/templates/). Deliberately separate from
    // `name`: that is prose for humans and can be reworded, this is an
    // identifier and must not change without renaming the template too.
    val visionKey = text("vision_key").uniqueIndex()

    val sourceBossName = text("source_boss_name").nullable()

    val iconRefKey = text("icon_ref_key").nullable()

    // Which section of the inventory a human expects to find this in ("Eternal Pieces",
    // "Symbols", "Consumables"). A different axis from redemption: that says what an item DOES,
    // this says where it LIVES. Symbols and elixirs are both consumables and nobody looks for
    // them in the same place. Seeded from catalog/items.yaml (V8, R__token_catalog.sql).
    val itemGroup = text("item_group").nullable()

    // Where this item sits within its section. Alphabetical is wrong for the symbols and wrongly
    // enough to confuse: they follow the AREAS' progression (Vanishing Journey -> Esfera, then
    // Cernium -> Tallahart), which is the order a player unlocks them in and the order the game's
    // own Symbol UI uses. Sorting by name interleaves the two rivers and puts Arcana first.
    val sortOrder = integer("sort_order").nullable()

    override val primaryKey = PrimaryKey(id)
}

// Items you collect N of and trade in. No row means the item is simply counted, which is
// most of them, and all of the consumables. "Is this redeemable?" is therefore not a flag that
// can drift out of step with the fields it governs; it is whether a rule exists (V7).
object RedemptionRule : Table("redemption_rule") {
    val itemId = reference("item_id", TokenCatalog.id)
    val redeemThreshold = integer("redeem_threshold")

    // What the token BUYS. The two sets do not overlap: Kalos / Kaling / First Adversary /
    // Malefic Star pieces make a Hat, Top, Bottom or Shoulder; Limbo and Baldrix pieces make a
    // Cape, Glove or Shoe. So ten of one plus ten of the other is not twenty pieces, it is one
    // armour and one accessory, and a UI that adds them is lying.
    val slotGroup = array<String>("slot_group")
    val bonusItemName = text("bonus_item_name").nullable()

    override val primaryKey = PrimaryKey(itemId)
}

object Screenshots : Table("screenshots") {
    val id = uuid("id")
    val userId = reference("user_id", Users.id)
    val characterId = optReference("character_id", Characters.id)

    // Nullable since V3: a FAILED row (the vision service was unreachable) never
    // got classified, so it has no type. Images are parsed in memory and
    // discarded, never persisted. Hence no storage_key column.
    val type = text("type").nullable()
    val uploadedAt = timestamp("uploaded_at")
    val parseStatus = text("parse_status").default("PENDING")

    // The parser's own output: grid coords, template match scores, digit reads.
    // Not a model response, and has not been one since the OpenCV rewrite (V5).
    val rawParseResult = jsonb<JsonElement>("raw_parse_result", Json).nullable()
    val detectedCharacterName = text("detected_character_name").nullable()
    val detectedLevel = integer("detected_level").nullable()

    override val primaryKey = PrimaryKey(id)
}

object CharacterTokenCount : Table("character_token_count") {
    // Composite PK directly gives the "unique per character+token" constraint
    // and matches the latest-snapshot upsert access pattern
    // (INSERT ... ON CONFLICT (character_id, token_catalog_id) DO UPDATE).
    val characterId = reference("character_id", Characters.id)
    val tokenCatalogId = reference("token_catalog_id", TokenCatalog.id)
    val quantity = integer("quantity")
    val capturedAt = timestamp("captured_at")
    val sourceScreenshotId = optReference("source_screenshot_id", Screenshots.id)

    override val primaryKey = PrimaryKey(characterId, tokenCatalogId)
}

object BossCatalog : Table("boss_catalog") {
    // No auto-default, seeded by R__boss_catalog.sql (generated from catalog/bosses.yaml),
    // which keeps an existing row's id across re-seeds since boss_clear references it.
    val id = uuid("id")
    val bossKey = text("boss_key").uniqueIndex()
    val name = text("name")
    val reset = text("reset")

    // Manifest position, so the matrix draws its columns in progression order rather than
    // alphabetically. See V12__boss_sort_order.sql.
    val sortOrder = integer("sort_order").nullable()
}

object BossClear : Table("boss_clear") {
    // Composite PK gives "unique per character+boss+period" and matches the latest-capture
    // upsert access pattern (INSERT ... ON CONFLICT (character_id, boss_catalog_id,
    // period_start) DO UPDATE). Rows with cleared=false are the character's routine for the
    // period, so pending bosses are known, not just clears.
    val characterId = reference("character_id", Characters.id)
    val bossCatalogId = reference("boss_catalog_id", BossCatalog.id)
    val periodStart = date("period_start")
    val cleared = bool("cleared")
    val capturedAt = timestamp("captured_at")
    val sourceScreenshotId = optReference("source_screenshot_id", Screenshots.id)

    override val primaryKey = PrimaryKey(characterId, bossCatalogId, periodStart)
}

// The groups a character runs bosses with. A roster only: what was actually killed stays in
// BossClear, which comes from a planner capture. See V16__party.sql.
object Party : Table("party") {
    val id = uuid("id")
    val userId = reference("user_id", Users.id)

    // Nullable. An unnamed party is labelled from its members, so the label is not stored.
    val name = text("name").nullable()
    val createdAt = timestamp("created_at")
    val updatedAt = timestamp("updated_at")

    override val primaryKey = PrimaryKey(id)
}

object PartyMember : Table("party_member") {
    val id = uuid("id")
    val partyId = reference("party_id", Party.id)
    val name = text("name")

    // Set when the seat is one of the caller's own characters. Optional, and SET NULL on delete,
    // so removing a character leaves the seat (and any loot split with it) readable.
    val characterId = optReference("character_id", Characters.id)

    // MVP status, not a fee rate. See V16__party.sql.
    val mvp = bool("mvp")
    val position = integer("position")

    override val primaryKey = PrimaryKey(id)
}

object PartyBoss : Table("party_boss") {
    val partyId = reference("party_id", Party.id)
    val bossCatalogId = reference("boss_catalog_id", BossCatalog.id)

    override val primaryKey = PrimaryKey(partyId, bossCatalogId)
}

// What a boss can drop, and the art shown beside it. Seeded by R__drop_catalog.sql from
// catalog/drops.yaml. Separate from TokenCatalog, which is what the parser counts in an
// inventory. See V17__drop_catalog.sql.
object DropCatalog : Table("drop_catalog") {
    // No auto-default: the seed keeps an existing row's id, which PartyLoot references.
    val id = uuid("id")
    val dropKey = text("drop_key").uniqueIndex()
    val name = text("name")

    // The file under seed-assets/drops, served at /drop-icons. Null when the pinned dataset has
    // no art for it, so the client knows to draw the row without an icon.
    val iconRefKey = text("icon_ref_key").nullable()

    // ALWAYS or HEROIC when every member gets their own copy, null when the party gets one. It
    // decides whether a drop is poolable at all, so it is data, not a label.
    val perMember = text("per_member").nullable()
    val worlds = text("worlds").nullable()
    val quantity = integer("quantity")
    val sortOrder = integer("sort_order")

    override val primaryKey = PrimaryKey(id)
}

object BossDrop : Table("boss_drop") {
    val bossCatalogId = reference("boss_catalog_id", BossCatalog.id)
    val dropCatalogId = reference("drop_catalog_id", DropCatalog.id)
    val sortOrder = integer("sort_order")

    override val primaryKey = PrimaryKey(bossCatalogId, dropCatalogId)
}

// A party's loot pool. Stores what was entered, never what was computed: the split arithmetic
// lives in frontend/lib/drop-split.ts and a second copy here would be a second answer.
object PartyLoot : Table("party_loot") {
    val id = uuid("id")
    val partyId = reference("party_id", Party.id)

    // Exactly one of these is set (party_loot_named_once).
    val dropCatalogId = optReference("drop_catalog_id", DropCatalog.id)
    val customName = text("custom_name").nullable()

    val bossCatalogId = optReference("boss_catalog_id", BossCatalog.id)
    val droppedOn = date("dropped_on")

    // The sale, all five columns or none of them (party_loot_sale_complete).
    val soldAt = timestamp("sold_at").nullable()
    val saleAmount = long("sale_amount").nullable()
    val amountBasis = text("amount_basis").nullable()
    val splitMethod = text("split_method").nullable()
    val sellerMemberId = optReference("seller_member_id", PartyMember.id)

    val createdAt = timestamp("created_at")
    val updatedAt = timestamp("updated_at")

    override val primaryKey = PrimaryKey(id)
}

// Who is owed for a sale, pinned at the moment it sold rather than re-derived from the party.
// See V18__party_loot.sql.
object PartyLootPayout : Table("party_loot_payout") {
    val lootId = reference("loot_id", PartyLoot.id)
    val memberId = reference("member_id", PartyMember.id)
    val paid = bool("paid")
    val paidAt = timestamp("paid_at").nullable()

    override val primaryKey = PrimaryKey(lootId, memberId)
}
