package com.maplestorage.backend.services

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.engine.mock.respondError
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import io.ktor.serialization.kotlinx.json.json
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

private const val EMPTY_RANKS_BODY = """{"totalCount":0,"ranks":[]}"""

private fun matchBody(
    level: Int,
    jobName: String,
    spriteUrl: String,
) = """{"totalCount":1,"ranks":[{"level":$level,"jobName":"$jobName","characterImgURL":"$spriteUrl"}]}"""

private fun jsonEngine(handler: (worldId: String?) -> String) =
    MockEngine { request ->
        respond(
            content = handler(request.url.parameters["id"]),
            status = HttpStatusCode.OK,
            headers = headersOf(HttpHeaders.ContentType, "application/json"),
        )
    }

private fun clientFor(engine: MockEngine) =
    HttpClient(engine) {
        install(ContentNegotiation) { json() }
    }

class NexonLookupServiceTest {
    @Test
    fun `returns null when all worlds have no match`() =
        runBlocking {
            val service = NexonLookupService(clientFor(jsonEngine { EMPTY_RANKS_BODY }))
            assertNull(service.lookup("NobodyHome"))
        }

    @Test
    fun `returns the match when exactly one world has it`() =
        runBlocking {
            val engine =
                jsonEngine { worldId ->
                    if (worldId == "45") {
                        matchBody(300, "Shadower", "https://msavatar1.nexon.net/x.png")
                    } else {
                        EMPTY_RANKS_BODY
                    }
                }
            val result = NexonLookupService(clientFor(engine)).lookup("MisaoMaki")

            assertEquals(300, result?.level)
            assertEquals("Shadower", result?.jobName)
            assertEquals("https://msavatar1.nexon.net/x.png", result?.spriteImgUrl)
        }

    @Test
    fun `one world erroring does not prevent another world's match from being returned`() =
        runBlocking {
            val engine =
                MockEngine { request ->
                    if (request.url.parameters["id"] == "1") {
                        respondError(HttpStatusCode.InternalServerError)
                    } else if (request.url.parameters["id"] == "19") {
                        respond(
                            content = matchBody(120, "Night Lord", "https://msavatar1.nexon.net/y.png"),
                            status = HttpStatusCode.OK,
                            headers = headersOf(HttpHeaders.ContentType, "application/json"),
                        )
                    } else {
                        respond(
                            content = EMPTY_RANKS_BODY,
                            status = HttpStatusCode.OK,
                            headers = headersOf(HttpHeaders.ContentType, "application/json"),
                        )
                    }
                }
            val result = NexonLookupService(clientFor(engine)).lookup("Whoever")

            assertEquals(120, result?.level)
        }

    @Test
    fun `malformed JSON on one world does not crash the others`() =
        runBlocking {
            val engine =
                jsonEngine { worldId ->
                    if (worldId == "1") "not json at all" else EMPTY_RANKS_BODY
                }
            assertNull(NexonLookupService(clientFor(engine)).lookup("Whoever"))
        }
}
