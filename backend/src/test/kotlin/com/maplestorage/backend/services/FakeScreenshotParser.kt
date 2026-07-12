package com.maplestorage.backend.services

// Hand-written fake rather than mocking the Anthropic Java SDK's OkHttp
// transport -- that transport isn't swappable the way ktor-client-mock swaps
// Ktor's engine, so ScreenshotIngestion's orchestration logic is exercised
// against this instead. Queue outcomes in call order; each parseScreenshot
// call consumes the next one.
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
