package com.maplestorage.backend.db

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import org.jetbrains.exposed.v1.core.Table
import org.jetbrains.exposed.v1.datetime.timestamp
import org.jetbrains.exposed.v1.json.jsonb

// Column definitions mirror db/migration/V1__create_core_schema.sql column-for-column.
// Flyway owns the actual DDL (see that file); these Table objects exist purely so
// route/repository code gets compile-time-checked query building instead of raw SQL
// string literals -- there is no SchemaUtils.create(...) call anywhere.

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

    override val primaryKey = PrimaryKey(id)
}

object TokenCatalog : Table("token_catalog") {
    // No auto-default. Rows are seeded by R__token_catalog.sql (generated from
    // catalog/items.yaml), which keeps an existing row's id across re-seeds -- these ids are
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

// Items you collect N of and trade in. No row means the item is simply counted -- which is
// most of them, and all of the consumables. "Is this redeemable?" is therefore not a flag that
// can drift out of step with the fields it governs; it is whether a rule exists (V7).
object RedemptionRule : Table("redemption_rule") {
    val itemId = reference("item_id", TokenCatalog.id)
    val redeemThreshold = integer("redeem_threshold")

    // What the token BUYS. The two sets do not overlap: Kalos / Kaling / First Adversary /
    // Malefic Star pieces make a Hat, Top, Bottom or Shoulder; Limbo and Baldrix pieces make a
    // Cape, Glove or Shoe. So ten of one plus ten of the other is not twenty pieces -- it is one
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
    // discarded, never persisted -- hence no storage_key column.
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
