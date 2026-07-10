package com.maplestorage.backend.plugins

import com.maplestorage.backend.config.Env
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.server.application.Application
import io.ktor.server.application.install
import io.ktor.server.plugins.cors.routing.CORS

// Two separate deployables (Vercel frontend, ECS-hosted backend) means the
// browser's fetch calls in backend-status.tsx are cross-origin by default --
// this is what makes them not get blocked. FRONTEND_ORIGIN is deliberately a
// single exact origin, not a wildcard, since credentials (the Clerk bearer
// token) are involved.
fun Application.configureCors() {
    install(CORS) {
        allowMethod(HttpMethod.Get)
        allowMethod(HttpMethod.Post)
        allowMethod(HttpMethod.Put)
        allowMethod(HttpMethod.Delete)
        allowHeader(HttpHeaders.Authorization)
        allowHeader(HttpHeaders.ContentType)
        allowHost(
            Env.frontendOrigin.removePrefix("https://").removePrefix("http://"),
            schemes = listOf("http", "https"),
        )
    }
}
