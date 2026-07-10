package com.maplestorage.backend

import com.maplestorage.backend.plugins.configureCors
import com.maplestorage.backend.plugins.configureDatabase
import com.maplestorage.backend.plugins.configureRouting
import com.maplestorage.backend.plugins.configureSecurity
import com.maplestorage.backend.plugins.configureSerialization
import io.ktor.server.application.Application
import io.ktor.server.engine.embeddedServer
import io.ktor.server.netty.Netty

fun main() {
    embeddedServer(Netty, port = 8080, host = "0.0.0.0", module = Application::module)
        .start(wait = true)
}

// CI smoke test: confirms this module compiles/lints on a bare GitHub-hosted
// runner, not just inside the pinned dev container.
fun Application.module() {
    configureSerialization()
    configureCors()
    configureSecurity()
    configureDatabase()
    configureRouting()
}
