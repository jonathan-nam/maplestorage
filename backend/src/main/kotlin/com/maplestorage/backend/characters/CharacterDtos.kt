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

@Serializable
data class CreateCharacterRequest(
    val name: String,
)

@Serializable
data class UpdateCharacterRequest(
    val name: String? = null,
    val level: Int? = null,
)
