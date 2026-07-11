package com.maplestorage.backend.services

import kotlinx.serialization.Serializable

// Schema matches PLAN.md's "Screenshot ingestion & vision-parsing pipeline"
// section exactly -- screenshotType lets Claude self-report when an upload
// isn't even a recognizable MapleStory inventory screen at all, distinct
// from "recognized but nothing detected."
enum class ScreenshotType { INVENTORY, UNRECOGNIZED }

@Serializable
data class CharacterHud(
    val name: String,
    val level: Int,
)

@Serializable
data class DetectedToken(
    val tokenName: String,
    val quantity: Int,
)

@Serializable
data class ScreenshotParseResult(
    val screenshotType: ScreenshotType,
    // Null when no HUD is visible in frame (e.g. a tightly-cropped inventory
    // upload) -- see PLAN.md: this case is always NEEDS_REVIEW even if a
    // character was pinned, since there's nothing in the image to verify a
    // pin against.
    val characterHud: CharacterHud?,
    val tokenCounts: List<DetectedToken>?,
)

sealed interface ClaudeVisionOutcome {
    data class Parsed(
        val result: ScreenshotParseResult,
        val inputTokens: Int,
        val outputTokens: Int,
    ) : ClaudeVisionOutcome

    // Screenshots.parseStatus needs an explicit FAILED state the user can see
    // and retry from -- unlike NexonLookupService, failures aren't collapsed
    // to null here.
    data class Failed(
        val reason: String,
    ) : ClaudeVisionOutcome
}

interface ClaudeVisionService {
    suspend fun parseScreenshot(
        imageBytes: ByteArray,
        mediaType: String,
    ): ClaudeVisionOutcome
}
