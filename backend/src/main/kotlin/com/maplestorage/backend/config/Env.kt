package com.maplestorage.backend.config

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

    private fun required(name: String): String =
        System.getenv(name) ?: error("Missing required environment variable: $name")
}
