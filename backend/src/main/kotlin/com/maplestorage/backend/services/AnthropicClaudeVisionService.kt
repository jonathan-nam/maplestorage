package com.maplestorage.backend.services

import com.anthropic.client.AnthropicClient
import com.anthropic.client.okhttp.AnthropicOkHttpClient
import com.anthropic.errors.AnthropicException
import com.anthropic.models.messages.Base64ImageSource
import com.anthropic.models.messages.ContentBlockParam
import com.anthropic.models.messages.ImageBlockParam
import com.anthropic.models.messages.MessageCreateParams
import com.anthropic.models.messages.TextBlockParam
import com.anthropic.models.messages.ThinkingConfigAdaptive
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.awt.Color
import java.awt.RenderingHints
import java.awt.image.BufferedImage
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.util.Base64
import javax.imageio.ImageIO

private const val MAX_TOKENS = 4096L

// The seed-assets PNGs are tiny (33-41px) -- too small a visual template on
// their own, live-verified: at that native size Claude can't reliably tell a
// token apart from the many other similarly-shaped/colored decoy gem and
// currency icons a well-farmed inventory tends to be full of. Upscaling
// (smooth, not pixelated) before sending gives it a much larger target to
// actually compare detail against, cheap since it's done once at startup.
private const val REFERENCE_ICON_RENDER_SIZE = 256

// The 6 fixed catalog tokens, seeded in M1 (V2__seed_token_catalog.sql /
// seed-assets/tokens/*.png) -- identical reference set for every request,
// loaded once from the classpath rather than per-call. Descriptions are
// hand-written from actually looking at each icon (see PLAN.md's M4 note) --
// live-verified this measurably reduces matching a visually-similar-but-
// wrong decoy gem (e.g. mixing up Kalos's Residual Determination with
// Blissful Fantasy Shard, both smallish round metallic-looking icons).
private val REFERENCE_ICON_FILES =
    listOf(
        Triple(
            "Distorted Ambition",
            "distorted-ambition.png",
            "a magenta/pink boot or shoe silhouette with a black spiked heel -- NOT a round gem",
        ),
        Triple(
            "Blissful Fantasy Shard",
            "blissful-fantasy-shard.png",
            "a gold/orange ornate winged emblem or seal shape",
        ),
        Triple("Echo of Ancient Resolve", "echo-ancient-resolve.png", "an orange/red circular flame-swirl burst"),
        Triple(
            "Ferocious Beast Entanglement Ring",
            "ferocious-beast-ring.png",
            "a multicolor/rainbow faceted gem cluster",
        ),
        Triple(
            "Kalos's Residual Determination",
            "kalos-residual-determination.png",
            "a blue circular medallion with a swirl pattern",
        ),
        Triple(
            "Trace of Eternal Loyalty",
            "trace-eternal-loyalty.png",
            "a cyan/blue spiky ink-splash or claw-mark shape",
        ),
    )

// NOTE (M4 accuracy investigation, see PLAN.md): token-count accuracy on
// dense, heavily-farmed inventories (100+ slots, lots of visually-similar
// decoy gem/currency icons) remains genuinely unreliable even with these
// improvements -- live-tested proof the model can read an isolated crop's
// stack-count number correctly and consistently, but confabulates different
// "confident" wrong numbers across repeated runs when asked to scan the
// whole scene, match against all 6 references, and read exact counts in one
// pass. A two-pass locate-then-verify split was tried and reverted: the
// verify half worked, but the locate half was itself inconsistent at
// comprehensively scanning the same dense grid, so it didn't clearly
// improve on single-pass and cost 2x the API calls. Not solved -- a human
// review step before writing CharacterTokenCount is the real mitigation
// until/unless a fundamentally different approach is tried.
private val PROMPT_INSTRUCTIONS =
    """
    You are parsing a MapleStory screenshot to identify a fixed set of 6 collectible tokens and
    (if visible) the player character's name and level.

    First determine screenshotType: "INVENTORY" if this is a recognizable MapleStory inventory
    window or a full game screen containing one, "UNRECOGNIZED" otherwise (a totally unrelated
    image, or one with no MapleStory inventory content).

    If INVENTORY: look for the character HUD (name-plate and level, normally bottom-left of a
    full game window). If no HUD is visible in frame (e.g. a tightly-cropped inventory-only
    screenshot), leave characterHud null -- do not guess.

    Then scan every visible inventory slot for icons matching the ${REFERENCE_ICON_FILES.size}
    reference icons provided below (each is labeled with its exact token name, a short
    description of its distinguishing color/shape, and the reference image itself). For each one
    you find, read the stack-count badge number in the corner of that slot as its quantity.
    Report tokenCounts using the exact reference names given -- do not invent or rename tokens,
    and do not report tokens that aren't one of the ${REFERENCE_ICON_FILES.size} references.

    IMPORTANT -- well-farmed inventories are typically full of OTHER small round/gem-shaped
    currency and decorative icons (mesos pouches, event gems, enhancement stones, etc.) that are
    NOT among these 6 tokens and are easy to confuse with them at a glance. Do not match on
    general shape/color family alone (e.g. "some kind of round colorful gem"). Only report a
    match when the icon's specific color pattern and shape closely align with the reference
    image and its description -- if a round gem-like icon doesn't clearly match one of the 6
    specific reference patterns, it's more likely an unrelated decoy than a stack-count read
    failure, and should be left out.

    Include your best match even if you're not fully certain -- small icons at typical screenshot
    resolution are often genuinely ambiguous, and there's no way to zoom in or hover for a tooltip
    the way a player could in-game. A plausible match the user can glance at and correct is far
    more useful than silently omitting a token you actually noticed but weren't 100% sure of.
    That said, prefer omitting a token entirely over guessing which specific one of the 6 it is
    when two references are genuinely hard to tell apart at this resolution -- a wrong name is
    worse than a missing row, since it corrupts a different token's count instead of just leaving
    one blank.
    """.trimIndent()

private fun loadClasspathResource(path: String): ByteArray =
    object {}
        .javaClass.classLoader
        .getResourceAsStream(path)
        ?.use { it.readBytes() }
        ?: error("Missing classpath resource: $path")

private fun upscale(pngBytes: ByteArray): ByteArray {
    val source = ImageIO.read(ByteArrayInputStream(pngBytes))
    val target = BufferedImage(REFERENCE_ICON_RENDER_SIZE, REFERENCE_ICON_RENDER_SIZE, BufferedImage.TYPE_INT_ARGB)
    val g = target.createGraphics()
    g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR)
    g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
    g.color = Color(0, 0, 0, 0)
    g.fillRect(0, 0, REFERENCE_ICON_RENDER_SIZE, REFERENCE_ICON_RENDER_SIZE)
    g.drawImage(source, 0, 0, REFERENCE_ICON_RENDER_SIZE, REFERENCE_ICON_RENDER_SIZE, null)
    g.dispose()
    return ByteArrayOutputStream().use {
        ImageIO.write(target, "png", it)
        it.toByteArray()
    }
}

private data class ReferenceIcon(
    val name: String,
    val description: String,
    val bytes: ByteArray,
)

private val REFERENCE_ICONS: List<ReferenceIcon> by lazy {
    REFERENCE_ICON_FILES.map { (name, filename, description) ->
        ReferenceIcon(name, description, upscale(loadClasspathResource("seed-assets/tokens/$filename")))
    }
}

class AnthropicClaudeVisionService(
    apiKey: String,
    private val model: String,
) : ClaudeVisionService {
    // Single client instance for the process lifetime, mirroring
    // NexonLookupService's single-HttpClient pattern.
    private val client: AnthropicClient = AnthropicOkHttpClient.builder().apiKey(apiKey).build()

    override suspend fun parseScreenshot(
        imageBytes: ByteArray,
        mediaType: String,
    ): ClaudeVisionOutcome =
        withContext(Dispatchers.IO) {
            // The SDK's .create() is a blocking OkHttp call, not suspend-native.
            try {
                // outputConfig(Class) derives the JSON schema from
                // ScreenshotParseResult via reflection and deserializes the
                // response back into it -- confirmed working live against a
                // plain Kotlin data class (no jackson-module-kotlin needed).
                //
                // Adaptive thinking, not disabled: live-tested both ways --
                // disabled thinking under a strict schema was silently
                // omitting tokens it wasn't fully certain about (no way to
                // hedge inside a rigid JSON field), and separately mixing up
                // visually-similar tokens. This is a genuinely harder visual
                // disambiguation task than a single-pass extraction, so it
                // gets room to reason before committing to an answer.
                val params =
                    MessageCreateParams
                        .builder()
                        .model(model)
                        .maxTokens(MAX_TOKENS)
                        .thinking(ThinkingConfigAdaptive.builder().build())
                        .addUserMessageOfBlockParams(buildContentBlocks(imageBytes, mediaType))
                        .outputConfig(ScreenshotParseResult::class.java)
                        .build()

                val response = client.messages().create(params)
                // With adaptive thinking on, content() has a thinking block
                // before the structured text block -- find the text block
                // specifically rather than assuming it's first().
                val result =
                    response
                        .content()
                        .firstNotNullOf { block -> block.text().orElse(null) }
                        .text()
                ClaudeVisionOutcome.Parsed(
                    result = result,
                    inputTokens = response.usage().inputTokens().toInt(),
                    outputTokens = response.usage().outputTokens().toInt(),
                )
            } catch (e: AnthropicException) {
                // Screenshots.parseStatus needs a visible FAILED state -- unlike
                // NexonLookupService, this doesn't collapse to null.
                ClaudeVisionOutcome.Failed(e.message ?: e::class.simpleName ?: "unknown Claude API error")
            }
        }

    private fun buildContentBlocks(
        imageBytes: ByteArray,
        mediaType: String,
    ): List<ContentBlockParam> {
        val blocks = mutableListOf<ContentBlockParam>()
        blocks += textBlock(PROMPT_INSTRUCTIONS)
        for (icon in REFERENCE_ICONS) {
            blocks += textBlock("Reference icon: ${icon.name} -- ${icon.description}")
            blocks += imageBlock(icon.bytes, "image/png")
        }
        blocks += textBlock("Screenshot to parse:")
        blocks += imageBlock(imageBytes, mediaType)
        return blocks
    }

    private fun textBlock(text: String): ContentBlockParam =
        ContentBlockParam.ofText(TextBlockParam.builder().text(text).build())

    private fun imageBlock(
        bytes: ByteArray,
        mediaType: String,
    ): ContentBlockParam =
        ContentBlockParam.ofImage(
            ImageBlockParam
                .builder()
                .source(
                    Base64ImageSource
                        .builder()
                        .mediaType(Base64ImageSource.MediaType.of(mediaType))
                        .data(Base64.getEncoder().encodeToString(bytes))
                        .build(),
                ).build(),
        )
}
