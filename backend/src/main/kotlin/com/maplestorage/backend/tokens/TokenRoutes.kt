package com.maplestorage.backend.tokens

import com.maplestorage.backend.db.CharacterTokenCount
import com.maplestorage.backend.db.Characters
import com.maplestorage.backend.db.RedemptionRule
import com.maplestorage.backend.db.TokenCatalog
import com.maplestorage.backend.plugins.principalIdAndEmail
import com.maplestorage.backend.users.activeWorldFor
import com.maplestorage.backend.users.ensureUser
import io.ktor.server.application.call
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.RoutingContext
import io.ktor.server.routing.get
import org.jetbrains.exposed.v1.core.JoinType
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.countDistinct
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.sum
import org.jetbrains.exposed.v1.jdbc.select
import org.jetbrains.exposed.v1.jdbc.transactions.transaction

fun Route.tokenRoutes() {
    get { getTokenTotals() }
}

private suspend fun RoutingContext.getTokenTotals() {
    val (userId, email) = call.principalIdAndEmail()
    val totals =
        transaction {
            ensureUser(userId, email)
            tokenTotalsFor(userId)
        }
    call.respond(totals)
}

// The aggregate the dashboard shows: every token this user holds, summed across
// all their characters. Doing this server-side rather than fetching each
// character's tokens and adding them up in the browser keeps it one query
// instead of one-per-character, and keeps the ownership filter in one place.
//
// Must be called inside a transaction. Internal rather than private so
// TokenTotalsTest can exercise this exact query, the ownership scoping and the
// GROUP BY are the two things most likely to be quietly wrong, and a test that
// re-typed the query would prove nothing about the one that actually runs.
internal fun tokenTotalsFor(userId: String): List<TokenTotalResponse> {
    val totalQuantity = CharacterTokenCount.quantity.sum()
    val contributors = CharacterTokenCount.characterId.countDistinct()

    return CharacterTokenCount
        .innerJoin(TokenCatalog)
        .innerJoin(Characters)
        // LEFT join: a consumable has no redemption rule, and must still be totalled.
        .join(RedemptionRule, JoinType.LEFT, onColumn = TokenCatalog.id, otherColumn = RedemptionRule.itemId)
        .select(
            TokenCatalog.id,
            TokenCatalog.name,
            TokenCatalog.iconRefKey,
            TokenCatalog.itemGroup,
            TokenCatalog.sortOrder,
            RedemptionRule.redeemThreshold,
            totalQuantity,
            contributors,
        )
        // Scope to this user's characters, in the world being shown. The join reaches every user's
        // character rows otherwise, so dropping the first leaks other people's counts into the
        // totals; dropping the second pools two worlds' inventories, which cannot be redeemed
        // against each other. Both silently, and both as a plausible-looking larger number.
        .where { (Characters.userId eq userId) and (Characters.worldType eq activeWorldFor(userId)) }
        .groupBy(
            TokenCatalog.id,
            TokenCatalog.name,
            TokenCatalog.iconRefKey,
            TokenCatalog.itemGroup,
            TokenCatalog.sortOrder,
            RedemptionRule.redeemThreshold,
        ).orderBy(TokenCatalog.sortOrder)
        .map { row ->
            TokenTotalResponse(
                tokenCatalogId = row[TokenCatalog.id].toString(),
                name = row[TokenCatalog.name],
                iconUrl = row[TokenCatalog.iconRefKey]?.let { "/token-icons/$it" },
                quantity = row[totalQuantity] ?: 0,
                itemGroup = row[TokenCatalog.itemGroup],
                redeemThreshold = row[RedemptionRule.redeemThreshold],
                characterCount = row[contributors].toInt(),
            )
        }
}
