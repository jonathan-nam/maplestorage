package com.maplestorage.backend.characters

import kotlinx.serialization.Serializable

@Serializable
data class CharacterResponse(
    val id: String,
    val name: String,
    val level: Int?,
    val jobName: String?,
    val worldName: String?,
    val spriteImgUrl: String?,
    val spriteRefreshedAt: String?,
    val createdAt: String,
    val updatedAt: String,
)

// Mirrored by frontend's types/character-token.ts field-for-field.
@Serializable
data class CharacterTokenResponse(
    val tokenCatalogId: String,
    val name: String,
    val iconUrl: String?,
    val quantity: Int,
    // Which section of the inventory this belongs in. See TokenCatalog.itemGroup.
    val itemGroup: String?,
    // Null for a consumable. There is no flag: an item is redeemable exactly when it has
    // a redemption rule, so a null threshold IS the answer to "is this redeemable?".
    val redeemThreshold: Int?,
    val capturedAt: String,
)

@Serializable
data class CreateCharacterRequest(
    val name: String,
)

@Serializable
data class UpdateCharacterRequest(
    val name: String? = null,
    val level: Int? = null,
)
