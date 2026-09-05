package com.sharpeyes.backend.parties

import com.sharpeyes.backend.db.BossCatalog
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyMember
import com.sharpeyes.backend.plugins.principalIdAndEmail
import com.sharpeyes.backend.users.ensureUser
import com.sharpeyes.backend.users.inActiveWorld
import io.ktor.server.response.respond
import io.ktor.server.routing.RoutingContext
import org.jetbrains.exposed.v1.core.JoinType
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.core.neq
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.transactions.transaction

// The parties somebody else owns that one of YOUR characters sits in.
//
// A second door, deliberately, rather than widening partiesFor. That function is what every party
// screen reads and it carries loot counts with it, so relaxing its ownership filter would put
// somebody else's pool in front of every existing caller at once. The dangerous half of a shared
// party is the crossing itself, so it happens in one place that does nothing else.
// Must be called from inside a `transaction { }` block.

/**
 * Every party of somebody else's that a character of yours is seated in.
 *
 * The authorisation rule IS the roster: you reach a party by owning a character with a seat in it,
 * and the seat states that as a foreign key rather than by matching a name. Failing closed is the
 * point. A seat that merely names your character gets you nothing, because binding happens only
 * where an invite was accepted. See V75 and InviteAccept.takeSeats.
 *
 * Narrowed to the world being shown, like every account-wide read, and to standing seats: a seat
 * you have been retired out of is a party you have left.
 */
internal fun partiesSeatedIn(userId: String): List<SeatedPartyResponse> {
    val myCharacters =
        Characters
            .selectAll()
            .where { (Characters.userId eq userId) and inActiveWorld(userId) }
            .map { it[Characters.id] }

    // Guarded rather than queried on an empty list, which is a WHERE that matches nothing dressed
    // up as a question.
    val mySeats =
        if (myCharacters.isEmpty()) {
            emptyList()
        } else {
            PartyMember
                .innerJoin(Party)
                .selectAll()
                .where {
                    (PartyMember.linkedCharacterId inList myCharacters) and
                        (PartyMember.standing eq true) and
                        // Never your own. Those are partiesFor's, with their pool and their money,
                        // and returning them here too would be two answers to one party.
                        (Party.userId neq userId)
                }.map { it[Party.id] to it[PartyMember.id].toString() }
        }
    if (mySeats.isEmpty()) return emptyList()

    val seatsByParty = mySeats.groupBy({ it.first }) { it.second }
    val partyIds = seatsByParty.keys.toList()
    // Read with YOUR user id, not the owner's: "whose character is this" is answered by your own
    // people list, which is the only address book you have. Their name for somebody is theirs.
    val seats = seatsFor(partyIds, userId)

    return Party
        .innerJoin(BossCatalog)
        .join(Characters, JoinType.INNER, Party.characterId, Characters.id)
        .selectAll()
        .where { Party.id inList partyIds }
        .orderBy(BossCatalog.sortOrder)
        .map { row ->
            val partyId = row[Party.id]
            SeatedPartyResponse(
                id = partyId.toString(),
                bossKey = row[BossCatalog.bossKey],
                difficulty = row[Party.difficulty],
                minutes = row[Party.minutes],
                seats = seats[partyId].orEmpty(),
                mySeatIds = seatsByParty[partyId].orEmpty(),
            )
        }
}

/**
 * GET /api/parties/seated. The parties you are in but do not own.
 *
 * Here rather than in PartyRoutes.kt, next to the one query it calls: this is the app's only read
 * that crosses accounts, and it is worth being able to see the route and the rule together.
 */
internal suspend fun RoutingContext.listSeatedParties() {
    val (userId, email) = call.principalIdAndEmail()
    val parties =
        transaction {
            ensureUser(userId, email)
            partiesSeatedIn(userId)
        }
    call.respond(parties)
}
