package com.maplestorage.backend.services

// Hand-written fake rather than mocking the Anthropic Java SDK's OkHttp
// transport -- that transport isn't swappable the way ktor-client-mock swaps
// Ktor's engine, so ScreenshotIngestion's orchestration logic is exercised
// against this instead. Queue outcomes in call order; each parseScreenshot
// call consumes the next one.
class FakeClaudeVisionService(
    private val outcomes: MutableList<ClaudeVisionOutcome>,
) : ClaudeVisionService {
    constructor(vararg outcomes: ClaudeVisionOutcome) : this(outcomes.toMutableList())

    val requestedMediaTypes = mutableListOf<String>()

    override suspend fun parseScreenshot(
        imageBytes: ByteArray,
        mediaType: String,
    ): ClaudeVisionOutcome {
        requestedMediaTypes.add(mediaType)
        check(outcomes.isNotEmpty()) { "FakeClaudeVisionService: no more queued outcomes" }
        return outcomes.removeAt(0)
    }
}
