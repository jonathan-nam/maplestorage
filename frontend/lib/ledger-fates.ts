// What a pile can be told became of its pieces, and how many each answer has room for.
//
// Split out of the card because of the way this goes wrong. A fate left off is not a missing
// control, it is a pile that can never reach "all accounted for": the count sits short and the card
// asks forever, with nothing on screen saying which answer it is waiting for.
//
// That is what BOUGHT being somebody else's fate did to your own card. You cannot buy your own
// coupons, which is true and is not what the option is for: it takes the pieces in a pile that are
// NOT the holder's, and your inventory holds those every time a night did not divide your way.
// Without it they could only be sold, so a pile you meant to keep never finished.
//
// `coversThePile` is that property, stated once so a test can hold it.

import { unaccounted } from "./vestige-ledger";
import type { HolderLedger } from "./vestige-ledger";

/** Every answer a pile can be given. All three, on every card, whoever is holding it. */
export const FATES = ["SOLD", "KEPT", "BOUGHT"] as const;

export type Fate = (typeof FATES)[number];

/**
 * How many pieces this fate has room for.
 *
 * A redemption stops at the holder's OWN share and a purchase at what is left over, because the
 * pieces past their share are not theirs to redeem. Bounding the redemption is only safe because the
 * purchase exists to take what it turns away: clamping with nowhere for the surplus to go would
 * record 195 of a 250 that really happened and leave 55 pieces waiting on a sale that is not coming.
 * See V50.
 *
 * A sale is bounded only by what is unaccounted for. It is not a claim about whose pieces they were,
 * so there is no share to measure it against.
 *
 * Rows already entered count against all three, so three of them cannot walk past what one cannot.
 */
export function roomFor(ledger: HolderLedger, fate: Fate): number {
  const left = unaccounted(ledger);
  if (fate === "KEPT") return Math.min(left, Math.max(0, ledger.ownShare - ledger.kept));
  if (fate === "BOUGHT")
    return Math.min(left, Math.max(0, ledger.pieces - ledger.ownShare - ledger.bought.pieces));
  return left;
}

/**
 * Whether the answers on offer can between them account for the whole pile without a sale.
 *
 * The invariant the card is built on, and the one thing about the fate list that cannot be seen by
 * looking at it. Every piece is either the holder's own or somebody else's, so a redemption and a
 * purchase cover the pile between them and nobody is forced to sell a coupon to make the count come
 * out. False means a pile has pieces with no honest answer, whoever holds it.
 */
export function coversThePile(ledger: HolderLedger): boolean {
  return roomFor(ledger, "KEPT") + roomFor(ledger, "BOUGHT") >= unaccounted(ledger);
}
