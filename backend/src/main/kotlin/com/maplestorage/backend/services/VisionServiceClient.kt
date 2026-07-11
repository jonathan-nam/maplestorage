package com.maplestorage.backend.services

import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.engine.cio.CIO
import io.ktor.client.plugins.HttpRequestTimeoutException
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.serialization.kotlinx.json.json
import io.ktor.utils.io.errors.IOException
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import org.slf4j.LoggerFactory

private val log = LoggerFactory.getLogger(VisionServiceClient::class.java)

// The vision service is a second container in the same ECS task, so this is a
// loopback call -- there is no network to be slow or flaky, and no retry logic
// worth writing. A parse is ~0.3s of CPU; the timeout only exists to stop a
// wedged vision container from holding a request thread forever.
private const val PARSE_TIMEOUT_MS = 15_000L

// Recorded against each screenshot in place of a model id. Cost accounting
// multiplies tokens by a per-model rate, and this service reports zero tokens,
// so the cost falls out at $0 without special-casing.
const val OPENCV_PARSER_ID = "opencv-classical"

private const val VISION_UNAVAILABLE = "Screenshot parsing is temporarily unavailable."

fun createVisionHttpClient(): HttpClient =
    HttpClient(CIO) {
        install(ContentNegotiation) {
            // The vision service sends fields the Kotlin DTOs do not model yet
            // (iconScore); ignoring them keeps the two sides independently
            // deployable.
            json(Json { ignoreUnknownKeys = true })
        }
        engine { requestTimeout = PARSE_TIMEOUT_MS }
    }

@Serializable
private data class VisionToken(
    val tokenName: String,
    val quantity: Int,
    val needsReview: Boolean = false,
)

@Serializable
private data class VisionHud(
    val name: String,
    val level: Int,
)

@Serializable
private data class VisionResult(
    val screenshotType: String,
    val characterHud: VisionHud? = null,
    val tokenCounts: List<VisionToken>? = null,
)

@Serializable
private data class VisionError(
    @SerialName("detail") val detail: String? = null,
)

/**
 * Parses screenshots by calling the co-located OpenCV vision service, rather
 * than a vision model.
 *
 * The service runs as a second container in the same ECS task (see `vision/`),
 * so this is a loopback call: one deployable, two processes.
 *
 * It implements [ClaudeVisionService] because that seam is already the right
 * shape -- the interface's name is now a misnomer and wants a rename, but that
 * is a mechanical change worth keeping out of this diff.
 *
 * The parse is deterministic: no tokens, no third-party call, same answer every
 * time. [ClaudeVisionOutcome.Parsed.inputTokens] and `outputTokens` are
 * therefore always zero.
 */
class VisionServiceClient(
    private val client: HttpClient,
    private val baseUrl: String,
) : ClaudeVisionService {
    override suspend fun parseScreenshot(
        imageBytes: ByteArray,
        mediaType: String,
    ): ClaudeVisionOutcome {
        // A vision container that is down or wedged is an infrastructure fault,
        // not a bad screenshot: FAILED lets the user retry the same upload once
        // it recovers.
        val response =
            try {
                client.post("$baseUrl/parse") {
                    contentType(ContentType.parse(mediaType))
                    setBody(imageBytes)
                }
            } catch (e: IOException) {
                log.error("vision service unreachable at {}", baseUrl, e)
                null
            } catch (e: HttpRequestTimeoutException) {
                log.error("vision service timed out after {}ms", PARSE_TIMEOUT_MS, e)
                null
            } ?: return ClaudeVisionOutcome.Failed(VISION_UNAVAILABLE)

        return when (response.status) {
            HttpStatusCode.OK -> parsed(response.body())

            // The vision service refuses a downscaled screenshot rather than
            // returning a plausible wrong count, and says why. That message is
            // written for the user, so pass it straight through.
            HttpStatusCode.UnprocessableEntity -> ClaudeVisionOutcome.Failed(detail(response.bodyAsText()))

            HttpStatusCode.BadRequest -> ClaudeVisionOutcome.Failed("That file could not be read as an image.")

            else -> {
                log.error("vision service returned {}: {}", response.status, response.bodyAsText())
                ClaudeVisionOutcome.Failed("Screenshot parsing failed.")
            }
        }
    }

    private fun parsed(body: VisionResult): ClaudeVisionOutcome {
        val type =
            when (body.screenshotType) {
                "INVENTORY" -> ScreenshotType.INVENTORY
                else -> ScreenshotType.UNRECOGNIZED
            }

        // A rescaled capture (fractional display scaling) still yields the right
        // icons but only ~70-77% reliable counts. The vision service flags those; until
        // ScreenshotParseResult can carry the flag through to the review
        // decision, log it loudly rather than let it pass silently as trusted.
        body.tokenCounts?.filter { it.needsReview }?.forEach {
            log.warn("low-confidence count from a rescaled capture: {}={}", it.tokenName, it.quantity)
        }

        val result =
            ScreenshotParseResult(
                screenshotType = type,
                characterHud = body.characterHud?.let { CharacterHud(name = it.name, level = it.level) },
                tokenCounts = body.tokenCounts?.map { DetectedToken(it.tokenName, it.quantity) },
            )
        return ClaudeVisionOutcome.Parsed(result = result, inputTokens = 0, outputTokens = 0)
    }

    private fun detail(raw: String): String =
        try {
            Json { ignoreUnknownKeys = true }.decodeFromString<VisionError>(raw).detail
        } catch (e: SerializationException) {
            log.warn("could not read vision error body: {}", raw, e)
            null
        } ?: "That screenshot could not be parsed."
}
