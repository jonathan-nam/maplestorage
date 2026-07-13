package com.maplestorage.backend.services

// Drives ScreenshotIngestion's orchestration through any parse outcome without a real parser.
// (The parser itself is a Ktor client and IS mocked properly, in VisionServiceClientTest.)
// Queue outcomes in call order; each parseScreenshot call consumes the next.
class FakeScreenshotParser(
    private val outcomes: MutableList<ScreenshotParseOutcome>,
) : ScreenshotParser {
    constructor(vararg outcomes: ScreenshotParseOutcome) : this(outcomes.toMutableList())

    val requestedMediaTypes = mutableListOf<String>()

    override suspend fun parseScreenshot(
        imageBytes: ByteArray,
        mediaType: String,
    ): ScreenshotParseOutcome {
        requestedMediaTypes.add(mediaType)
        check(outcomes.isNotEmpty()) { "FakeScreenshotParser: no more queued outcomes" }
        return outcomes.removeAt(0)
    }
}
