package com.maplestorage.backend.screenshots

import com.maplestorage.backend.characters.CharacterResponse
import com.maplestorage.backend.characters.findOwnedCharacter
import com.maplestorage.backend.db.CharacterTokenCount
import com.maplestorage.backend.db.Characters
import com.maplestorage.backend.db.Screenshots
import com.maplestorage.backend.db.TokenCatalog
import com.maplestorage.backend.db.UsageLedger
import com.maplestorage.backend.services.ClaudeVisionOutcome
import com.maplestorage.backend.services.ClaudeVisionService
import com.maplestorage.backend.services.DetectedToken
import com.maplestorage.backend.services.ScreenshotParseResult
import com.maplestorage.backend.services.ScreenshotType
import com.maplestorage.backend.users.ensureUser
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.encodeToJsonElement
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.lowerCase
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import org.jetbrains.exposed.v1.jdbc.update
import org.jetbrains.exposed.v1.jdbc.upsert
import java.math.BigDecimal
import java.math.MathContext
import kotlin.time.Clock
import kotlin.time.Instant
import kotlin.uuid.Uuid

// Estimated only -- no quota/billing enforcement reads UsageLedger yet
// (PLAN.md's M9 note). claude-sonnet-5's intro rate ($2/$10 per MTok) runs
// through 2026-08-31; falls back to standard pricing after, and to a rough
// default for any model not in this table rather than failing the request.
private val MODEL_PRICING_PER_MTOK =
    mapOf(
        "claude-sonnet-5" to (BigDecimal("2.00") to BigDecimal("10.00")),
        "claude-opus-4-8" to (BigDecimal("5.00") to BigDecimal("25.00")),
    )
private val DEFAULT_PRICING_PER_MTOK = BigDecimal("3.00") to BigDecimal("15.00")
private const val TOKENS_PER_MTOK = 1_000_000
private val MTOK = BigDecimal(TOKENS_PER_MTOK)

private fun estimateCostUsd(
    model: String,
    inputTokens: Int,
    outputTokens: Int,
): BigDecimal {
    val (inputPrice, outputPrice) = MODEL_PRICING_PER_MTOK[model] ?: DEFAULT_PRICING_PER_MTOK
    return (inputPrice * BigDecimal(inputTokens) + outputPrice * BigDecimal(outputTokens))
        .divide(MTOK, MathContext.DECIMAL64)
}

private data class OutcomeDecision(
    val outcome: ScreenshotOutcome,
    val parseStatus: String,
    val characterId: Uuid?,
)

// Ownership of `pinnedCharacterId` (if present) must already be verified by
// the caller -- see ScreenshotRoutes.kt's pre-check -- so this never has to
// distinguish "not owned" from "not pinned."
suspend fun ingestScreenshot(
    userId: String,
    email: String,
    request: UploadScreenshotRequest,
    pinnedCharacterId: Uuid?,
    claudeVisionService: ClaudeVisionService,
    model: String,
): ScreenshotResultResponse {
    val imageBytes =
        java.util.Base64
            .getDecoder()
            .decode(request.imageBase64)
    val visionOutcome = claudeVisionService.parseScreenshot(imageBytes, request.mediaType)

    return transaction {
        ensureUser(userId, email)
        when (visionOutcome) {
            is ClaudeVisionOutcome.Failed -> insertFailedScreenshot(userId, pinnedCharacterId, visionOutcome.reason)
            is ClaudeVisionOutcome.Parsed -> insertParsedScreenshot(userId, pinnedCharacterId, visionOutcome, model)
        }
    }
}

private fun insertFailedScreenshot(
    userId: String,
    pinnedCharacterId: Uuid?,
    reason: String,
): ScreenshotResultResponse {
    val screenshotId = Uuid.random()
    Screenshots.insert {
        it[id] = screenshotId
        it[Screenshots.userId] = userId
        it[characterId] = pinnedCharacterId
        it[type] = null
        it[uploadedAt] = Clock.System.now()
        it[parseStatus] = "FAILED"
    }
    return ScreenshotResultResponse(screenshotId.toString(), ScreenshotOutcome.FAILED, failureReason = reason)
}

private fun insertParsedScreenshot(
    userId: String,
    pinnedCharacterId: Uuid?,
    parsed: ClaudeVisionOutcome.Parsed,
    model: String,
): ScreenshotResultResponse {
    val result = parsed.result
    val pinnedCharacter = pinnedCharacterId?.let { findOwnedCharacter(it, userId) }
    val decision = decideOutcome(userId, pinnedCharacterId, pinnedCharacter, result)

    val screenshotId = Uuid.random()
    val now = Clock.System.now()
    Screenshots.insert {
        it[id] = screenshotId
        it[Screenshots.userId] = userId
        it[characterId] = decision.characterId
        it[type] = result.screenshotType.name
        it[uploadedAt] = now
        it[parseStatus] = decision.parseStatus
        it[rawModelResponse] = Json.encodeToJsonElement(result)
        it[detectedCharacterName] = result.characterHud?.name
        it[detectedLevel] = result.characterHud?.level
    }

    UsageLedger.insert {
        it[id] = Uuid.random()
        it[UsageLedger.userId] = userId
        it[UsageLedger.screenshotId] = screenshotId
        it[inputTokens] = parsed.inputTokens
        it[outputTokens] = parsed.outputTokens
        it[estimatedCostUsd] = estimateCostUsd(model, parsed.inputTokens, parsed.outputTokens)
        it[createdAt] = now
    }

    if (decision.outcome == ScreenshotOutcome.MATCHED) {
        upsertTokenCounts(decision.characterId!!, result.tokenCounts.orEmpty(), screenshotId, now)
    }

    return ScreenshotResultResponse(
        screenshotId = screenshotId.toString(),
        outcome = decision.outcome,
        detectedCharacterName = result.characterHud?.name,
        detectedLevel = result.characterHud?.level,
        pinnedCharacterName = pinnedCharacter?.name,
        tokenCounts = describeTokens(result.tokenCounts.orEmpty()),
    )
}

// A HUD and a pin are both attribution sources, and the pin is the stronger one:
// the HUD is something we inferred from pixels, the pin is a human telling us the
// answer outright. So a pin attributes on its own, and the HUD's job is to
// contradict it when the two disagree.
//
// This used to read "a pin is only ever a cross-check target, never a blind
// attribution source: no HUD -> always NEEDS_REVIEW, even with a pin." That rule
// came from the vision-model era, when the parser could hallucinate a name and the
// pin existed purely to catch it doing so. It inverted the trust: an upload with a
// pin and no HUD was rejected not because we doubted it, but because we had no
// second opinion to confirm it -- so we asked the user to pick a character they had
// already picked, on a screenshot we had already read perfectly. The upload page
// tells people a cropped inventory is fine; this made a liar of it.
//
// The MISMATCH branch below is the case that rule was really protecting, and it is
// untouched: if a HUD IS present and disagrees with the pin, we still refuse to
// guess.
private fun decideOutcome(
    userId: String,
    pinnedCharacterId: Uuid?,
    pinnedCharacter: CharacterResponse?,
    result: ScreenshotParseResult,
): OutcomeDecision =
    when {
        // No inventory in frame means no counts to attribute, so a pin buys nothing.
        result.screenshotType == ScreenshotType.UNRECOGNIZED ->
            OutcomeDecision(ScreenshotOutcome.UNRECOGNIZED_SCREENSHOT, "NEEDS_REVIEW", pinnedCharacterId)

        pinnedCharacterId != null ->
            when {
                // Pinned to a character we cannot resolve (deleted, or not this user's).
                // Never fall through to auto-attribution here: the HUD could name some
                // OTHER character and we would silently save to them instead of the one
                // the user asked for.
                pinnedCharacter == null ->
                    OutcomeDecision(ScreenshotOutcome.UNRESOLVABLE, "NEEDS_REVIEW", null)

                // Nothing in the image to contradict the pin: take the user at their word.
                result.characterHud == null ->
                    OutcomeDecision(ScreenshotOutcome.MATCHED, "SUCCESS", pinnedCharacterId)

                pinnedCharacter.name.equals(result.characterHud.name, ignoreCase = true) ->
                    OutcomeDecision(ScreenshotOutcome.MATCHED, "SUCCESS", pinnedCharacterId)

                else ->
                    OutcomeDecision(ScreenshotOutcome.MISMATCH, "NEEDS_REVIEW", pinnedCharacterId)
            }

        // Unpinned, and no name in the image: there is genuinely no way to know whose
        // this is, so ask.
        result.characterHud == null ->
            OutcomeDecision(ScreenshotOutcome.UNRESOLVABLE, "NEEDS_REVIEW", pinnedCharacterId)

        else ->
            findCharacterIdByName(userId, result.characterHud.name)
                ?.let { OutcomeDecision(ScreenshotOutcome.MATCHED, "SUCCESS", it) }
                ?: OutcomeDecision(ScreenshotOutcome.NEW_CHARACTER_DETECTED, "NEEDS_REVIEW", null)
    }

private fun findCharacterIdByName(
    userId: String,
    name: String,
): Uuid? =
    Characters
        .selectAll()
        .where { (Characters.userId eq userId) and (Characters.name.lowerCase() eq name.lowercase()) }
        .singleOrNull()
        ?.get(Characters.id)

// Resolves the parser's keys to what a human should see. Done server-side, from
// the catalog, because the display name is not derivable from the key.
private fun describeTokens(tokens: List<DetectedToken>): List<DetectedTokenResponse> {
    val catalog =
        TokenCatalog.selectAll().associate {
            it[TokenCatalog.visionKey] to
                (it[TokenCatalog.name] to it[TokenCatalog.iconRefKey])
        }
    return tokens.map { token ->
        val (displayName, iconRefKey) = catalog[token.tokenName] ?: (token.tokenName to null)
        DetectedTokenResponse(
            tokenName = token.tokenName,
            displayName = displayName,
            iconUrl = iconRefKey?.let { "/token-icons/$it" },
            quantity = token.quantity,
        )
    }
}

private fun upsertTokenCounts(
    characterId: Uuid,
    tokens: List<DetectedToken>,
    screenshotId: Uuid,
    capturedAt: Instant,
) {
    val catalogIdsByVisionKey =
        TokenCatalog.selectAll().associate {
            it[TokenCatalog.visionKey] to it[TokenCatalog.id]
        }
    for (token in tokens) {
        // The parser can only ever emit a key it has a template for, so an
        // unmatched one means the catalog and the templates have drifted apart.
        // That is a bug, and it must be loud: this lookup used to fall back to
        // `continue`, which silently dropped EVERY token when the parser switched
        // from display names to slugs, and no test noticed.
        val catalogId =
            catalogIdsByVisionKey[token.tokenName]
                ?: error(
                    "No token_catalog row with vision_key='${token.tokenName}'. The parser's " +
                        "templates and the catalog have drifted -- see V4__token_catalog_vision_key.sql.",
                )
        CharacterTokenCount.upsert(CharacterTokenCount.characterId, CharacterTokenCount.tokenCatalogId) { row ->
            row[CharacterTokenCount.characterId] = characterId
            row[CharacterTokenCount.tokenCatalogId] = catalogId
            row[quantity] = token.quantity
            row[CharacterTokenCount.capturedAt] = capturedAt
            row[sourceScreenshotId] = screenshotId
        }
    }
}

// Powers all three of PLAN.md's "new character detected" actions (confirm-add
// = create the character via the existing M2 endpoint, then call this; pick-
// existing = call this directly) plus mismatch's one-click fix and
// unresolvable's manual picker -- none of them need the image again, since
// the parsed result was already persisted to `rawModelResponse`.
fun resolveScreenshot(
    userId: String,
    screenshotId: Uuid,
    newCharacterId: Uuid,
): Boolean =
    transaction {
        val row =
            Screenshots
                .selectAll()
                .where { (Screenshots.id eq screenshotId) and (Screenshots.userId eq userId) }
                .singleOrNull() ?: return@transaction false
        if (row[Screenshots.parseStatus] != "NEEDS_REVIEW") return@transaction false
        val rawResponse = row[Screenshots.rawModelResponse] ?: return@transaction false
        val tokens =
            Json.decodeFromJsonElement<ScreenshotParseResult>(rawResponse).tokenCounts ?: return@transaction false
        findOwnedCharacter(newCharacterId, userId) ?: return@transaction false

        upsertTokenCounts(newCharacterId, tokens, screenshotId, Clock.System.now())
        Screenshots.update({ Screenshots.id eq screenshotId }) {
            it[characterId] = newCharacterId
            it[parseStatus] = "SUCCESS"
        }
        true
    }

fun ignoreScreenshot(
    userId: String,
    screenshotId: Uuid,
): Boolean =
    transaction {
        Screenshots.update({ (Screenshots.id eq screenshotId) and (Screenshots.userId eq userId) }) {
            it[parseStatus] = "IGNORED"
        } > 0
    }
