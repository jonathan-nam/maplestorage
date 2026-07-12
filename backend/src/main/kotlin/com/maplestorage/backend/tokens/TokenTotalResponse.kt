package com.maplestorage.backend.tokens

import kotlinx.serialization.Serializable

// Mirrored by frontend's types/token-total.ts field-for-field.
@Serializable
data class TokenTotalResponse(
    val tokenCatalogId: String,
    val name: String,
    val iconUrl: String?,
    val quantity: Int,
    val redeemThreshold: Int,
    // How many characters contributed to `quantity`. Without it, a total of 40 is
    // ambiguous between one hoarder and ten mules, which is exactly the question
    // the aggregate view exists to answer.
    val characterCount: Int,
)
