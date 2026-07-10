package com.maplestorage.backend.plugins

import kotlinx.serialization.Serializable

@Serializable
data class PingResponse(
    val userId: String,
    val dbTimestamp: String,
)
