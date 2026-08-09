package com.maplestorage.backend.parties

import com.maplestorage.backend.db.BossDropAmount
import com.maplestorage.backend.db.Party
import com.maplestorage.backend.db.PartyLoot
import com.maplestorage.backend.db.PartyMember
import com.maplestorage.backend.db.PersonCharacter
import org.jetbrains.exposed.v1.core.JoinType
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.jdbc.selectAll
import kotlin.uuid.Uuid

// Which drops in a pool are still WORK, as against a record of something that already went right.
//
// Split from LootQueries.kt only for size, and because the answer needs three tables that nothing
// else in there touches.
//
// The distinction exists because a drop that comes in pieces is settled through the tranche ledger
// and NEVER through a sale on its own row. Its sold_at stays null for ever, so "not sold" says
// nothing about it, and counting it as pending put every coupon drop the account had ever had into
// the pool permanently, on parties whose split came out exactly even. Mirrors isOutstanding in
// frontend/lib/drop-log.ts, which decides the same thing for the Drop Log.

/**
 * The drops in these parties that come in pieces, at the mode each party runs.
 *
 * Per (boss, difficulty), so a party with no mode recorded matches no amount: nothing is claimed
 * about its drops and they are counted the ordinary way.
 */
internal fun pieceLootIds(partyIds: List<Uuid>): Set<Uuid> {
    if (partyIds.isEmpty()) return emptySet()
    return PartyLoot
        .join(Party, JoinType.INNER, PartyLoot.partyId, Party.id)
        .join(BossDropAmount, JoinType.INNER) {
            (BossDropAmount.bossCatalogId eq PartyLoot.bossCatalogId) and
                (BossDropAmount.dropCatalogId eq PartyLoot.dropCatalogId) and
                (BossDropAmount.difficulty eq Party.difficulty)
        }.selectAll()
        .where { PartyLoot.partyId inList partyIds }
        .map { it[PartyLoot.id] }
        .toSet()
}

/**
 * The parties where somebody ELSE is holding your share of a piece drop.
 *
 * That is the looter, unless the looter is one of your own characters: then you already have it,
 * and so does everybody else, because the coupons went where they belong on the night.
 *
 * "One of yours" the way holderOf reads it, personId FIRST: a seat matched to somebody on the
 * people list is theirs even where a character of that name is also yours.
 */
internal fun partiesHoldingYourShare(partyIds: List<Uuid>): Set<Uuid> {
    if (partyIds.isEmpty()) return emptySet()
    val theirs =
        PersonCharacter
            .selectAll()
            .map { it[PersonCharacter.name].lowercase() }
            .toSet()
    return Party
        .join(PartyMember, JoinType.INNER, Party.looterMemberId, PartyMember.id)
        .selectAll()
        .where { Party.id inList partyIds }
        .filter { it[PartyMember.name].lowercase() in theirs || it[PartyMember.characterId] == null }
        .map { it[Party.id] }
        .toSet()
}
