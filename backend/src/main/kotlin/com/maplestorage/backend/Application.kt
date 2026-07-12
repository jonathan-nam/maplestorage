package com.maplestorage.backend

import com.maplestorage.backend.config.Env
import com.maplestorage.backend.plugins.configureCors
import com.maplestorage.backend.plugins.configureDatabase
import com.maplestorage.backend.plugins.configureRouting
import com.maplestorage.backend.plugins.configureSecurity
import com.maplestorage.backend.plugins.configureSerialization
import com.maplestorage.backend.plugins.configureTiming
import com.maplestorage.backend.services.NexonLookupService
import com.maplestorage.backend.services.VisionServiceClient
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
    configureTiming()
    configureSerialization()
    configureCors()
    configureSecurity()
    configureDatabase()

    val nexonHttpClient = createNexonHttpClient()
    monitor.subscribe(ApplicationStopped) { nexonHttpClient.close() }

    // Screenshots are parsed by the co-located OpenCV vision service (a second
    // container in the same ECS task): no third-party call, no metering, and the
    // same answer every time for the same bytes.
    val visionHttpClient = createVisionHttpClient()
    monitor.subscribe(ApplicationStopped) { visionHttpClient.close() }
    val screenshotParser = VisionServiceClient(visionHttpClient, Env.visionServiceUrl)

    configureRouting(NexonLookupService(nexonHttpClient), screenshotParser)
}
