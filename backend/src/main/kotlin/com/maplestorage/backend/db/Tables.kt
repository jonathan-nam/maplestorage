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

private const val DEFAULT_REDEEM_THRESHOLD = 10
private const val ESTIMATED_COST_PRECISION = 10
private const val ESTIMATED_COST_SCALE = 6

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
    // No auto-default -- the 6 rows get fixed UUID literals from the V2 seed
    // migration, not randomly generated ones, so this catalog has stable,
    // referenceable IDs across re-seeds.
    val id = uuid("id")
    val name = text("name").uniqueIndex()
    val sourceBossName = text("source_boss_name").nullable()
    val slotGroup = array<String>("slot_group").nullable()
    val redeemThreshold = integer("redeem_threshold").default(DEFAULT_REDEEM_THRESHOLD)
    val bonusItemName = text("bonus_item_name").nullable()
    val iconRefKey = text("icon_ref_key").nullable()

    override val primaryKey = PrimaryKey(id)
}

object Screenshots : Table("screenshots") {
    val id = uuid("id")
    val userId = reference("user_id", Users.id)
    val characterId = optReference("character_id", Characters.id)

    // Nullable since V3: a FAILED row (the Claude call itself errored) never
    // got classified, so it has no type. Images are parsed in memory and
    // discarded, never persisted -- hence no storage_key column.
    val type = text("type").nullable()
    val uploadedAt = timestamp("uploaded_at")
    val parseStatus = text("parse_status").default("PENDING")
    val rawModelResponse = jsonb<JsonElement>("raw_model_response", Json).nullable()
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

object UsageLedger : Table("usage_ledger") {
    val id = uuid("id")
    val userId = reference("user_id", Users.id)
    val screenshotId = optReference("screenshot_id", Screenshots.id)
    val inputTokens = integer("input_tokens")
    val outputTokens = integer("output_tokens")
    val estimatedCostUsd = decimal("estimated_cost_usd", ESTIMATED_COST_PRECISION, ESTIMATED_COST_SCALE)
    val createdAt = timestamp("created_at")

    override val primaryKey = PrimaryKey(id)
}
