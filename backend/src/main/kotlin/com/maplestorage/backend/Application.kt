package com.maplestorage.backend

import com.maplestorage.backend.config.Env
import com.maplestorage.backend.plugins.configureCors
import com.maplestorage.backend.plugins.configureDatabase
import com.maplestorage.backend.plugins.configureRouting
import com.maplestorage.backend.plugins.configureSecurity
import com.maplestorage.backend.plugins.configureSerialization
import com.maplestorage.backend.services.AnthropicClaudeVisionService
import com.maplestorage.backend.services.NexonLookupService
import com.maplestorage.backend.services.createNexonHttpClient
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

    val claudeVisionService = AnthropicClaudeVisionService(Env.anthropicApiKey, Env.anthropicModel)

    configureRouting(NexonLookupService(nexonHttpClient), claudeVisionService, Env.anthropicModel)
}
