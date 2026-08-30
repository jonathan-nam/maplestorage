package com.sharpeyes.backend.services

import kotlinx.serialization.Serializable

// Screenshots are parsed by the vision service (vision/), which is OpenCV: it
// matches the client's own icons against the inventory grid and reads the stack
// counts with the client's own digit glyphs. No model is called, and nothing here
// is probabilistic, an icon either matches the template or it does not.
//
// This interface was called ScreenshotParser, and its result ScreenshotParseOutcome,
// back when a vision model did the work. The names outlived the model by a whole
// rewrite. That is not a cosmetic problem: a lookup that quietly matched the wrong
// column survived for days partly because the code around it still described a
// system that no longer existed, and nobody reading it had reason to doubt the names.

// UNRECOGNIZED means the image has no inventory grid in it at all, a login screen,
// a desktop, a cat. Distinct from "an inventory with nothing we track in it."
//
// PLANNER means no grid but a Maple Planner boss list. It is NOT a statement about which payloads
// arrived: one capture routinely holds both panels, so an INVENTORY result can carry bossClears
// too. Read the payloads, not the type.
enum class ScreenshotType { INVENTORY, PLANNER, UNRECOGNIZED }

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
data class DetectedBossClear(
    // The catalog key, not the name the planner rendered. Resolved vision-side against the same
    // generated catalog that feeds boss_catalog, so there is no second mapping to keep.
    val bossKey: String,
    val cleared: Boolean,
)

@Serializable
data class ScreenshotParseResult(
    val screenshotType: ScreenshotType,
    // Null when no HUD is in frame, e.g. a tightly-cropped inventory. Attribution
    // then falls to the user's pin (see ScreenshotIngestion.decideOutcome).
    val characterHud: CharacterHud?,
    val tokenCounts: List<DetectedToken>?,
    // Null when no planner was in frame. Empty is different: a planner WAS read and every row in
    // it was unreadable, which unreadableBossRows then explains.
    val bossClears: List<DetectedBossClear>? = null,
    // Did the capture reach the bottom of the boss list? The list takes 1-3 scrolled captures, so
    // without this the top of an all-cleared list reads as "everything cleared" while the bosses
    // below the fold are still pending. Best-effort, see vision's planner.parse_planner.
    val reachedListEnd: Boolean? = null,
    // Was every inventory slot in frame, unobscured, and its count readable? Only then does an
    // item's absence from tokenCounts mean the player holds none, and only then may ingest clear
    // a count it did not hear about. Null or false means "cannot tell gone from not seen", and
    // the safe reading is to leave existing counts alone. See vision's cv/grid.coverage.
    val inventoryComplete: Boolean? = null,
    // Rows the reader found but could not name. Never silently dropped: a dropped row would read
    // as "not cleared", which is a plausible wrong answer of exactly the kind this project exists
    // to prevent, so it reaches the user as "re-capture".
    val unreadableBossRows: Int? = null,
)

sealed interface ScreenshotParseOutcome {
    data class Parsed(
        val result: ScreenshotParseResult,
    ) : ScreenshotParseOutcome

    // Screenshots.parseStatus needs an explicit FAILED state the user can see and
    // retry from. Unlike NexonLookupService, failures aren't collapsed to null here.
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
