package com.maplestorage.backend.services

import kotlinx.serialization.Serializable

// Screenshots are parsed by the vision service (vision/), which is OpenCV: it
// matches the client's own icons against the inventory grid and reads the stack
// counts with the client's own digit glyphs. No model is called, and nothing here
// is probabilistic -- an icon either matches the template or it does not.
//
// This interface was called ScreenshotParser, and its result ScreenshotParseOutcome,
// back when a vision model did the work. The names outlived the model by a whole
// rewrite. That is not a cosmetic problem: a lookup that quietly matched the wrong
// column survived for days partly because the code around it still described a
// system that no longer existed, and nobody reading it had reason to doubt the names.

// UNRECOGNIZED means the image has no inventory grid in it at all -- a login screen,
// a desktop, a cat. Distinct from "an inventory with nothing we track in it."
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
    // Null when no HUD is in frame, e.g. a tightly-cropped inventory. Attribution
    // then falls to the user's pin (see ScreenshotIngestion.decideOutcome).
    val characterHud: CharacterHud?,
    val tokenCounts: List<DetectedToken>?,
)

sealed interface ScreenshotParseOutcome {
    data class Parsed(
        val result: ScreenshotParseResult,
    ) : ScreenshotParseOutcome

    // Screenshots.parseStatus needs an explicit FAILED state the user can see and
    // retry from -- unlike NexonLookupService, failures aren't collapsed to null here.
    data class Failed(
        val reason: String,
    ) : ScreenshotParseOutcome
}

interface ScreenshotParser {
    suspend fun parseScreenshot(
        imageBytes: ByteArray,
        mediaType: String,
    ): ScreenshotParseOutcome
}
