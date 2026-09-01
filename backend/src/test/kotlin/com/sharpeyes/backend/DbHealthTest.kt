package com.sharpeyes.backend

import com.sharpeyes.backend.plugins.respondDbHealth
import io.ktor.client.request.get
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpStatusCode
import io.ktor.serialization.kotlinx.json.json
import io.ktor.server.application.install
import io.ktor.server.plugins.contentnegotiation.ContentNegotiation
import io.ktor.server.plugins.statuspages.StatusPages
import io.ktor.server.routing.get
import io.ktor.server.routing.routing
import io.ktor.server.testing.testApplication
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals

// /health/db exists to be watched from outside, so what has to hold is that an unreachable database
// produces a STATUS CODE rather than a stack trace. A monitor reads status codes.
//
// No database here on purpose: the failure branches are the ones worth pinning, and they are the
// ones a working database cannot exercise. The seed tests cover the real connection.
class DbHealthTest {
    private fun assertHealth(
        expected: HttpStatusCode,
        expectedBody: String,
        probe: () -> Boolean,
    ) = testApplication {
        application {
            install(ContentNegotiation) { json(Json) }
            // Fails the test loudly if respondDbHealth ever lets an exception escape, instead of
            // the 500 quietly looking like just another non-200.
            install(StatusPages) {
                exception<Throwable> { _, cause -> throw AssertionError("escaped: $cause") }
            }
            routing {
                get("/health/db") { call.respondDbHealth(probe) }
            }
        }

        val response = client.get("/health/db")
        assertEquals(expected, response.status)
        assertEquals(expectedBody, response.bodyAsText())
    }

    @Test
    fun `reports ok when the database answers`() = assertHealth(HttpStatusCode.OK, """{"status":"ok"}""") { true }

    @Test
    fun `reports 503 when the probe comes back false`() =
        assertHealth(HttpStatusCode.ServiceUnavailable, """{"status":"db unreachable"}""") { false }

    @Test
    fun `reports 503 rather than throwing when the connection is refused`() =
        assertHealth(HttpStatusCode.ServiceUnavailable, """{"status":"db unreachable"}""") {
            error("connection refused")
        }
}
