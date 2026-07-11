package com.maplestorage.backend.screenshots

import kotlinx.serialization.Serializable

@Serializable
data class UploadScreenshotRequest(
    val imageBase64: String,
    val mediaType: String,
    val characterId: String? = null,
)

@Serializable
data class ResolveScreenshotRequest(
    val characterId: String,
)

enum class ScreenshotOutcome {
    MATCHED,
    MISMATCH,
    NEW_CHARACTER_DETECTED,
    UNRESOLVABLE,
    UNRECOGNIZED_SCREENSHOT,
    FAILED,
}

@Serializable
data class ScreenshotResultResponse(
    val screenshotId: String,
    val outcome: ScreenshotOutcome,
    val detectedCharacterName: String? = null,
    val detectedLevel: Int? = null,
    val pinnedCharacterName: String? = null,
    val failureReason: String? = null,
)
