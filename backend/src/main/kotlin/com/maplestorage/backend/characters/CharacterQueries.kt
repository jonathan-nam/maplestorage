package com.maplestorage.backend.characters

import com.maplestorage.backend.db.Characters
import org.jetbrains.exposed.v1.core.ResultRow
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.jdbc.selectAll
import kotlin.uuid.Uuid

// Shared by CharacterRoutes.kt's ownership-checked read/update/refresh/delete
// handlers -- must be called from inside a `transaction { }` block.
fun findOwnedCharacter(
    characterId: Uuid,
    userId: String,
): CharacterResponse? =
    Characters
        .selectAll()
        .where { (Characters.id eq characterId) and (Characters.userId eq userId) }
        .singleOrNull()
        ?.toCharacterResponse()

fun ResultRow.toCharacterResponse() =
    CharacterResponse(
        id = this[Characters.id].toString(),
        name = this[Characters.name],
        level = this[Characters.level],
        jobName = this[Characters.jobName],
        worldName = this[Characters.worldName],
        spriteImgUrl = this[Characters.spriteImgUrl],
        spriteRefreshedAt = this[Characters.spriteRefreshedAt]?.toString(),
        createdAt = this[Characters.createdAt].toString(),
        updatedAt = this[Characters.updatedAt].toString(),
    )
