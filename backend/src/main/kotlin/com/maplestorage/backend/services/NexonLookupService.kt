package com.maplestorage.backend.services

import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.engine.cio.CIO
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.request.get
import io.ktor.client.request.url
import io.ktor.http.HttpStatusCode
import io.ktor.serialization.kotlinx.json.json
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.supervisorScope
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

// Single client instance for the app's lifetime. Constructed once in
// Application.kt's module() and passed into NexonLookupService, not
// rebuilt per-request. ignoreUnknownKeys since Nexon's response carries
// ~10 fields (exp, gap, legionLevel, raidPower, tierID, score, characterID,
// rank, startRank, worldID, isSearchTarget) this app doesn't use.
fun createNexonHttpClient(): HttpClient =
    HttpClient(CIO) {
        install(ContentNegotiation) {
            json(Json { ignoreUnknownKeys = true })
        }
    }

// Live-verified 2026-07-11: the nexon.com no-auth ranking endpoint's
// type=world requires a specific numeric world id. There is no
// single-call "search by name across all worlds." Probing ids 0-120 found
// only these 4 currently non-empty (modern GMS has consolidated into very
// few merged worlds). No human-readable world name is ever returned by
// this endpoint (only numeric worldID), so Characters.worldName is left
// null by this service. See CharacterRoutes.kt.
// Names are deliberately just ordinal placeholders, not real GMS world
// names. Nexon's own name for each of these 4 IDs was never confirmed
// (see the class doc above), so naming these after guessed real worlds
// would misrepresent this as a verified mapping to a future reader.
private const val KNOWN_WORLD_ID_A = 1
private const val KNOWN_WORLD_ID_B = 19
private const val KNOWN_WORLD_ID_C = 45
private const val KNOWN_WORLD_ID_D = 70
private val KNOWN_WORLD_IDS = listOf(KNOWN_WORLD_ID_A, KNOWN_WORLD_ID_B, KNOWN_WORLD_ID_C, KNOWN_WORLD_ID_D)
private const val LOOKUP_TIMEOUT_MS = 5_000L

data class NexonLookupResult(
    val level: Int,
    val jobName: String,
    val spriteImgUrl: String,
)

// First outbound HTTP call in this codebase. Preserves the "add character
// by name only" UX (WEB-UI-SPEC.md) despite the endpoint's per-world
// requirement by fanning out one concurrent lookup per known world and
// taking whichever one matches, rather than asking the user for their world.
class NexonLookupService(
    private val client: HttpClient,
) {
    // Never throws, a failed/timed-out/malformed lookup is indistinguishable
    // from "character not found" to callers, both falling through to manual
    // entry (POST /api/characters never errors because of this lookup).
    suspend fun lookup(characterName: String): NexonLookupResult? =
        supervisorScope {
            KNOWN_WORLD_IDS
                .map { worldId -> async { runCatching { queryWorld(worldId, characterName) }.getOrNull() } }
                .awaitAll()
                .filterNotNull()
                // Defensive: the same name matching >1 world simultaneously is
                // possible in principle. Take the first rather than crash.
                .firstOrNull()
        }

    private suspend fun queryWorld(
        worldId: Int,
        name: String,
    ): NexonLookupResult? {
        val response =
            withTimeout(LOOKUP_TIMEOUT_MS) {
                client.get("https://www.nexon.com/api/maplestory/no-auth/ranking/v2/na") {
                    url {
                        parameters.append("type", "world")
                        parameters.append("id", worldId.toString())
                        parameters.append("page_index", "1")
                        parameters.append("character_name", name)
                    }
                }
            }
        val rank =
            response
                .takeIf { it.status == HttpStatusCode.OK }
                ?.body<NexonRankingResponse>()
                ?.ranks
                ?.firstOrNull()
        return rank?.let { NexonLookupResult(it.level, it.jobName, it.characterImgURL) }
    }
}

@Serializable
private data class NexonRankingResponse(
    val totalCount: Int,
    val ranks: List<NexonRankEntry>,
)

@Serializable
private data class NexonRankEntry(
    val level: Int,
    val jobName: String,
    val characterImgURL: String,
)
