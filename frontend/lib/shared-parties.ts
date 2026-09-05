import { cellState, clearOfCell } from "./boss-clears";
import { splitOf } from "./loot";
import type { Loot } from "@/types/loot";
import type { SeatedParty } from "@/types/party";

/**
 * Whether YOUR character has cleared a shared party's boss, for the period being shown.
 *
 * Your own account's answer, not the owner's. `boss_clear` is keyed on a CHARACTER, so the tick a
 * party carries is about the owner's character and answers "have they run it", where the question
 * on a shared card is "have I". Both accounts record the same night, once each, because the run is
 * one run and each captures their own planner.
 *
 * Read through cellState and clearOfCell, which is the same reading Party View and the Boss Clears
 * table use. A second way to read a tick is how two screens come to disagree about it.
 *
 * Null where this account cannot answer: your seat has no character bound to it, which is every
 * seat until an invite is accepted. Null is also what "no capture has mentioned it" reads as, and
 * the two are the same thing to a reader, which is nothing claimed either way.
 */
export function yourClear(
  party: SeatedParty,
  clearsByCharacter: Map<string, Map<string, boolean>>,
): boolean | null {
  const mine = party.seats.find((seat) => party.mySeatIds.includes(seat.id));
  if (!mine?.linkedCharacterId) return null;
  return clearOfCell(cellState(clearsByCharacter.get(mine.linkedCharacterId), party.bossKey));
}

/** What one night leaves in YOUR hands, and whether it has arrived. */
export type YourShare = {
  /** Mesos you end up holding, after the fee on the transfer to you. */
  nets: number;
  paid: boolean;
};

/**
 * Your own share of a night, or null while there is nothing to be owed.
 *
 * Through splitOf, which is the split the OWNER's screens show, so a member reading what they are
 * owed and an owner reading what they owe cannot come to different figures. splitOf wants the seats
 * and not a whole party, which is the reason this works from a SeatedParty at all: those seats are
 * already in hand and no second read of somebody else's pool is needed.
 *
 * Null covers everything that is not an answer: a drop still in the pool, a sale this build cannot
 * read the basis of, and a night whose seats do not include one of yours. A missing figure beats a
 * wrong one, and zero would be a claim that you are owed nothing.
 *
 * The seller is a case of its own. They are not paid, they are the one paying out, so what they
 * hold is `keeps` and it is already in their hands. In an Interactive party the looter sells, and
 * the looter can be the member rather than the owner.
 */
export function yourShare(night: Loot, party: SeatedParty): YourShare | null {
  const split = splitOf(night, party.seats);
  if (!split) return null;
  if (party.mySeatIds.includes(split.seller.memberId)) {
    return { nets: split.seller.keeps, paid: true };
  }
  const mine = split.shares.find((share) => party.mySeatIds.includes(share.memberId));
  return mine ? { nets: mine.nets, paid: mine.paid } : null;
}
