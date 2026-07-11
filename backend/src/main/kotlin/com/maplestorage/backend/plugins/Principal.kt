package com.maplestorage.backend.plugins

import io.ktor.http.HttpStatusCode
import io.ktor.server.application.ApplicationCall
import io.ktor.server.auth.jwt.JWTPrincipal
import io.ktor.server.auth.principal
import io.ktor.server.response.respond
import kotlin.uuid.Uuid

// Shared by every authenticated route handler (characters/, screenshots/).
fun ApplicationCall.principalIdAndEmail(): Pair<String, String> {
    val principal = principal<JWTPrincipal>()!!
    val userId = principal.payload.subject
    // Verify against a real Clerk JWT during implementation -- expected empty
    // unless a custom JWT template adding an `email` claim is configured in
    // the Clerk dashboard (Security.kt's own comment already establishes the
    // default template carries no custom claims beyond `sub`).
    val email =
        principal.payload
            .getClaim("email")
            ?.asString()
            .orEmpty()
    return userId to email
}

suspend fun ApplicationCall.parseUuidParam(name: String): Uuid? {
    val raw = parameters[name]
    val id = raw?.let { Uuid.parseOrNull(it) }
    if (id == null) {
        respond(HttpStatusCode.BadRequest, "malformed $name")
    }
    return id
}
