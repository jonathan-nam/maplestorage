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
//
// The other half is `asksAnything`: WHETHER a pile has a question at all. Since #354 deleted the
// apportioning, no debt is derived from these rows, so a pile that owes nobody gets the same figures
// whatever it is told. Asking it to account for itself is work with no reader.

import { holderKey, unaccounted } from "./vestige-ledger";
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

/**
 * Pieces this pile owes somebody, across the drops still open.
 *
 * Off the transfers, which are already filtered to what THIS holder owes, so a pile you are merely
 * the creditor of counts zero: what they are holding of yours is the Collection Ledger's to say.
 */
export function owes(ledger: HolderLedger): number {
  return ledger.drops
    .filter((d) => !d.closed)
    .reduce((sum, d) => sum + d.transfers.reduce((n, t) => n + t.pieces, 0), 0);
}

/**
 * How much of what this pile owes has been answered, which only a purchase can do.
 *
 * A redemption is the holder's own share by definition, so it settles nothing they owe. A SALE does
 * not either, and that is the one worth saying: coupons are single-trade, so selling the creditor's
 * pieces does not hand them back, and since #354 there is no apportioning to say which of a mixed
 * pile went out. What is left after a sale is the same debt, in pieces, waiting on an agreed figure.
 * BOUGHT is that agreement. See V50.
 *
 * Capped, because a holder may have bought pieces on a night whose books were later closed.
 */
export function settledOf(ledger: HolderLedger): number {
  return Math.min(owes(ledger), ledger.bought.pieces);
}

/**
 * Whether the card has a question, or is only somewhere a sale MAY be recorded.
 *
 * A night that divided the way it fell is finished when it is logged. Nothing is derived from what
 * became of those coupons, so "0 of 1140 pieces accounted for" asked for 1140 pieces of typing to
 * move a figure nobody reads. The count is an instruction, and an instruction with no consequence is
 * the narration this app's screens are not allowed to carry.
 *
 * What is asked is the DEBT, not the pile: of 1160 coupons in your inventory, 1150 are your own and
 * nobody is waiting on them. Counting the pile demanded 1160 answers for a 10-piece debt.
 *
 * Over-entry still speaks, whoever holds the pile: more entered than the pile holds is a miscount,
 * and a card that went quiet about it would be hiding what it dropped rather than saying it short.
 */
export function asksAnything(ledger: HolderLedger): boolean {
  return settledOf(ledger) < owes(ledger) || ledger.accounted > ledger.pieces;
}

/**
 * Your own piles, split by whether the Sale Ledger has a reason to draw one.
 *
 * A pile that owes somebody, or one with rows already recorded, is a card: there is something to
 * answer or something to correct. A pile with neither is a place a sale MAY be recorded and nothing
 * else, and drawn anyway it is a permanent "holding 1140" at a reader with nothing to do about it.
 *
 * The quiet ones are held back, not dropped. Dropping them would re-break what `alsoHeldByYou`
 * exists for, which is that a Sale Ledger refusing to admit you hold the coupons cannot take the
 * sale. They come back the moment the reader asks to record one.
 */
export function worthDrawing(
  yours: HolderLedger[],
  recorded: (key: string) => boolean,
): { drawn: HolderLedger[]; quiet: HolderLedger[] } {
  const drawn: HolderLedger[] = [];
  const quiet: HolderLedger[] = [];
  for (const ledger of yours) {
    const has = asksAnything(ledger) || recorded(holderKey(ledger.holder));
    (has ? drawn : quiet).push(ledger);
  }
  return { drawn, quiet };
}
