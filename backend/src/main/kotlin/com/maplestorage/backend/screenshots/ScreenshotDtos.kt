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
    // What we actually read off the image. Sent back on EVERY outcome, not just
    // the successful one -- a screenshot that needs review has still been parsed,
    // and showing the user "we read these 6 tokens, just tell us whose they are"
    // is the difference between a one-click confirmation and a blank row that
    // looks like nothing happened. (It looked like nothing happened, because the
    // response dropped them.)
    val tokenCounts: List<DetectedTokenResponse> = emptyList(),
)

@Serializable
data class DetectedTokenResponse(
    // The parser's key (token_catalog.vision_key), e.g. "kalos-token".
    val tokenName: String,
    // The human name, e.g. "Kalos's Residual Determination". The two are not
    // derivable from each other -- that assumption is exactly what silently broke
    // token persistence -- so the server resolves it from the catalog and sends
    // both rather than letting the client guess.
    val displayName: String,
    val iconUrl: String?,
    val quantity: Int,
)
