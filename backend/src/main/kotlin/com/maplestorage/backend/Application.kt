package com.maplestorage.backend

import com.maplestorage.backend.config.Env
import com.maplestorage.backend.plugins.configureCors
import com.maplestorage.backend.plugins.configureDatabase
import com.maplestorage.backend.plugins.configureRouting
import com.maplestorage.backend.plugins.configureSecurity
import com.maplestorage.backend.plugins.configureSerialization
import com.maplestorage.backend.services.NexonLookupService
import com.maplestorage.backend.services.OPENCV_PARSER_ID
import com.maplestorage.backend.services.VisionSidecarService
import com.maplestorage.backend.services.createNexonHttpClient
import com.maplestorage.backend.services.createVisionHttpClient
import io.ktor.server.application.Application
import io.ktor.server.application.ApplicationStopped
import io.ktor.server.engine.embeddedServer
import io.ktor.server.netty.Netty

fun main() {
    embeddedServer(Netty, port = 8080, host = "0.0.0.0", module = Application::module)
        .start(wait = true)
}

fun Application.module() {
    configureSerialization()
    configureCors()
    configureSecurity()
    configureDatabase()

    val nexonHttpClient = createNexonHttpClient()
    monitor.subscribe(ApplicationStopped) { nexonHttpClient.close() }

    // Screenshots are parsed by the OpenCV sidecar, not a vision model: no
    // tokens, no third-party call, and the same answer every time. The
    // Anthropic implementation is kept in tree for now as a reference and a
    // fallback, but nothing constructs it.
    val visionHttpClient = createVisionHttpClient()
    monitor.subscribe(ApplicationStopped) { visionHttpClient.close() }
    val screenshotParser = VisionSidecarService(visionHttpClient, Env.visionServiceUrl)

    configureRouting(NexonLookupService(nexonHttpClient), screenshotParser, OPENCV_PARSER_ID)
}
