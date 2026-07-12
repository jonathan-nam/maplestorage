package com.maplestorage.backend.config

// A narrow forced-schema extraction task fits Sonnet-tier at a fraction of
// Opus's cost; ANTHROPIC_MODEL overrides it either direction.
private const val DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5"

private const val DEFAULT_VISION_SERVICE_URL = "http://127.0.0.1:8000"

// Central place to read the environment variables the ECS task definition
// injects (see infra/ecs.tf's `environment`/`secrets` blocks) -- fail fast at
// startup if one is missing rather than surfacing a null deep in a request.
object Env {
    val dbHost: String get() = required("DB_HOST")
    val dbPort: String get() = required("DB_PORT")
    val dbName: String get() = required("DB_NAME")
    val dbUsername: String get() = required("DB_USERNAME")
    val dbPassword: String get() = required("DB_PASSWORD")
    val clerkJwksUrl: String get() = required("CLERK_JWKS_URL")
    val frontendOrigin: String get() = required("FRONTEND_ORIGIN")
    val anthropicApiKey: String get() = required("ANTHROPIC_API_KEY")

    // Overridable so switching model tiers is a config change, not a deploy.
    val anthropicModel: String get() = System.getenv("ANTHROPIC_MODEL") ?: DEFAULT_ANTHROPIC_MODEL

    // The vision service runs as a second container in the same ECS task, so
    // this is loopback by default and only needs overriding for local dev.
    val visionServiceUrl: String get() = System.getenv("VISION_SERVICE_URL") ?: DEFAULT_VISION_SERVICE_URL

    private fun required(name: String): String =
        System.getenv(name) ?: error("Missing required environment variable: $name")
}
