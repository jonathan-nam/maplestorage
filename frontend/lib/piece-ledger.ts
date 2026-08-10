// Who owes who, when a drop arrives in pieces and one person picks up more than their share.
//
// A boss drops vestige coupons in bundles, more bundles than a small party has members, so they do
// not divide by looting alone: somebody ends up holding pieces that are not theirs. This works out
// who is short, who is over, what the transfers between them are, and what those are worth once the
// pieces have actually been sold.
//
// It is NOT the money split in drop-split.ts, and it is not a second copy of it. That file divides
// one pot among seats and grosses each payout up for the fee on its hop. This one divides a COUNT,
// which is exact, and turns into mesos only through the prices the seller really got.
//
// Pieces are liquid and the price moves, so a stack goes out in tranches: 100 at 25m, then 80 at
// 24m. Nothing here stores an average. The tranches are what a human entered and the average is
// derived from them, so a price nobody got cannot end up in a payout.
//
// Not every piece is for sale. A holder may redeem their own share instead, and coupons are
// single-trade, so a holder who does that cannot hand the pieces they owe to somebody who wants to
// sell: the receiver would get something unsellable. Only the holder can turn a creditor's share
// into mesos. So a pile is priced over the part of it that is FOR SALE, never the whole pile. See
// `sellableOf`. Measuring against the whole pile was issue #281: the creditor was paid the fraction
// of their claim that matched the fraction of the pile the holder happened to sell.

import { FEE_STANDARD } from "./drop-split";

/** One tranche, as the seller entered it. */
export type PieceSale = {
  pieces: number;
  /** Listed price of ONE piece in that tranche. */
  priceEach: number;
};

/** One seat on a stacking drop: what they took, and what fraction of it is theirs. */
export type LedgerSeat = {
  memberId: string;
  name: string;
  /** Pieces they picked up. */
  looted: number;
  /** Their weight in the even share. 1 unless the party agreed somebody takes more. */
  shares: number;
};

/** What one seat was entitled to against what they took. */
export type SeatBalance = {
  memberId: string;
  name: string;
  entitled: number;
  looted: number;
  /** Pieces owed TO them. Negative means they are holding that many that are not theirs. */
  balance: number;
};

/** How far through the stack the seller is. */
export type SaleProgress = {
  piecesSold: number;
  unsold: number;
  /** Listed value of everything sold so far. */
  gross: number;
  /** Exact average listed price of a piece sold, or null before anything has. */
  averagePrice: number | null;
  /**
   * Every piece is accounted for, so what each seat is owed can be stated as a final figure. Until
   * then it cannot: the pieces still to shift may go at a different price, and the average so far
   * would put a number on screen that the last tranche is about to change.
   */
  complete: boolean;
  /** More pieces sold than the row says dropped, which is a miscount rather than a payout. */
  oversold: boolean;
};

/** One transfer that clears part of the ledger. */
export type PieceTransfer = {
  fromId: string;
  toId: string;
  from: string;
  to: string;
  pieces: number;
  /** How many of those pieces have sold, so this much of the debt is settled and cannot move. */
  settled: number;
  /**
   * Mesos to send NOW, for the pieces that have sold. Null while none of them have.
   *
   * Pro rata over the SELLABLE pile, so a debt is cleared in instalments as the stack goes rather
   * than in one payment at the end. It comes to the same money as waiting, but only because every
   * sellable piece eventually sells: taken over the whole pile instead, a holder who kept part of
   * theirs left the receiver stuck at the same fraction of their claim, permanently and with the
   * holder holding the lever. That was issue #281. What pro rata buys is that the receiver does not
   * wait on the last piece of a stack that may sit for weeks, and no instalment is ever revised,
   * because each one is settled against the price its own tranches really got.
   *
   * Sending exactly this leaves the receiver holding what they would have held had they looted those
   * pieces and sold them themselves: they pay the Auction House once on the way in, which is the one
   * fee their own sale would have cost them. The sender pays a fee on their sale too, so the second
   * hop is theirs to eat, and that is what taking somebody else's pieces costs.
   */
  send: number | null;
  /** What the receiver is left holding after the fee on that transfer. Null with `send`. */
  nets: number | null;
};

/** What has sold, and whether that is all of it. Money is derived here and stored nowhere. */
export function saleProgress(total: number, sales: PieceSale[]): SaleProgress {
  const piecesSold = sales.reduce((sum, s) => sum + s.pieces, 0);
  const gross = sales.reduce((sum, s) => sum + s.pieces * s.priceEach, 0);
  return {
    piecesSold,
    unsold: Math.max(0, total - piecesSold),
    gross,
    averagePrice: piecesSold > 0 ? gross / piecesSold : null,
    complete: piecesSold === total && total > 0,
    oversold: piecesSold > total,
  };
}

/**
 * A whole divided by weights, in whole units that add up to exactly the whole.
 *
 * Everyone gets the floor of their exact share, then the odd units go to the biggest fractions, ties
 * by position. Deterministic, so the same input always divides the same way and a figure somebody
 * has already been paid does not move to a different row on the next read.
 *
 * Zeroes when there is nothing to divide, or no weight to divide it by.
 */
export function largestRemainder(total: number, weights: number[]): number[] {
  const weight = weights.reduce((sum, w) => sum + w, 0);
  if (weights.length === 0 || weight <= 0 || total <= 0) return weights.map(() => 0);

  const exact = weights.map((w) => (total * w) / weight);
  const share = exact.map(Math.floor);
  let left = total - share.reduce((sum, n) => sum + n, 0);

  const order = exact
    .map((value, i) => ({ i, fraction: value - (share[i] ?? 0) }))
    .sort((a, b) => b.fraction - a.fraction || a.i - b.i);

  for (const { i } of order) {
    if (left <= 0) break;
    share[i] = (share[i] ?? 0) + 1;
    left -= 1;
  }
  return share;
}

/**
 * What each seat was entitled to.
 *
 * Pieces are whole, so a share of them usually is not: 181 across four is 45.25 each. The point of
 * dividing it by the largest remainder is that the entitlements add up to exactly what dropped,
 * which is what makes the balances below sum to zero and the transfers clear the ledger completely
 * rather than nearly.
 */
export function entitlements(total: number, seats: LedgerSeat[]): Map<string, number> {
  const share = largestRemainder(
    total,
    seats.map((s) => s.shares),
  );
  return new Map(seats.map((s, i) => [s.memberId, share[i] ?? 0]));
}

/** Every seat's position: what they should have, what they took, and the difference. */
export function balances(total: number, seats: LedgerSeat[]): SeatBalance[] {
  const entitled = entitlements(total, seats);
  return seats.map((s) => {
    const owed = entitled.get(s.memberId) ?? 0;
    return {
      memberId: s.memberId,
      name: s.name,
      entitled: owed,
      looted: s.looted,
      balance: owed - s.looted,
    };
  });
}

/** One boss's pieces in the queue: what dropped, who took it, and where it sits in line. */
export type LedgerDrop = {
  id: string;
  /** The reset week it was cleared in. Drops from one week share a place in the queue. */
  weekStart: string;
  /** Tie-break inside a week: the boss's own progression order, so the queue never shuffles. */
  order: number;
  /** What fell. Entitlements are measured against this, so it is the whole drop, not a slice. */
  total: number;
  seats: LedgerSeat[];
  /**
   * Pieces of it in the pile this row is about. Defaults to `total`, which is one seat having
   * looted the lot.
   *
   * Separate from `total` because a drop looted stack by stack sits in SEVERAL piles at once, and
   * the two numbers answer different questions. Who owes whom is measured against the whole drop.
   * What a holder's own sales can cover, and how much of their proceeds are somebody else's, is
   * measured against their pile: they can only ever sell what they picked up, and charging their
   * tranches against the whole drop would report a debt settled that their sales never touched.
   */
  held?: number;
  /**
   * Pieces of this pile the holder is redeeming rather than selling. Absent is none of them.
   *
   * Taken out of the denominator every price is derived from, because a piece that will never be
   * listed can never contribute a price. Not capped at the holder's own entitlement on purpose: a
   * holder who keeps more than their share is eating somebody else's pieces, and pricing those at
   * the average their own sales got is the one figure available that nobody made up.
   */
  kept?: number;
};

/** Pieces in the pile a row is about. The looter's whole drop unless it was split at the stack. */
export function heldOf(drop: LedgerDrop): number {
  return drop.held ?? drop.total;
}

/**
 * Pieces of the pile that are actually for sale, which is what every price here is derived from.
 *
 * Floored at zero: keeping more than you hold is a miscount, not a negative pile, and letting it go
 * negative would flip the sign of every payout derived from it.
 */
export function sellableOf(drop: LedgerDrop): number {
  return Math.max(0, heldOf(drop) - (drop.kept ?? 0));
}

/**
 * Pieces of this pile that are the holder's OWN, which is what a redemption comes off first.
 *
 * Their entitlement, capped by what they are actually holding: a seat owed more than they picked up
 * has no surplus of their own to redeem. Absent holder reads the pile as all theirs, which is one
 * seat having looted the lot.
 *
 * The line a redemption crosses, so `spreadKept` and the card that labels it read it from here
 * rather than each deciding for themselves.
 */
export function ownShareOf(drop: LedgerDrop, holder?: string): number {
  if (holder === undefined) return heldOf(drop);
  return Math.min(heldOf(drop), entitlements(drop.total, drop.seats).get(holder) ?? 0);
}

/** How much of one drop the sales so far have covered, and what those pieces fetched. */
export type DropCoverage = {
  covered: number;
  /** Listed value of the covered pieces, at the prices they actually went for. */
  cost: number;
  /**
   * Pieces of this pile that are for sale, which is what `covered` counts towards.
   *
   * Carried out so a caller can tell the two zero-progress states apart. Nothing sold yet with
   * pieces still to list is a pile waiting; nothing sold with nothing left to list is a pile that
   * will never produce a price, and saying "priced when they sell" about it is a promise that
   * cannot come true.
   */
  sellable: number;
  /**
   * Every sellable piece has sold, so nothing about it can move again.
   *
   * False for a wholly kept pile, which has no realized price and so no debt that can be stated.
   * That is a refusal, not an oversight: the alternative is pricing somebody's share at a figure
   * nobody was ever offered.
   */
  complete: boolean;
  /** Weighted average listed price of the pieces that covered it. Null until it is covered. */
  averagePrice: number | null;
};

/** The queue's order: first cleared, first paid, with the boss's own order breaking a week. */
function inQueueOrder(drops: LedgerDrop[]): LedgerDrop[] {
  return [...drops].sort(
    (a, b) =>
      a.weekStart.localeCompare(b.weekStart) || a.order - b.order || a.id.localeCompare(b.id),
  );
}

/**
 * Which drops a holder's redeemed pieces came off: their OWN share first, newest end first.
 *
 * A redemption is a count and nothing more: a coupon in an inventory has no boss written on it, so
 * which clear it came from is not a fact anybody has. It has to be decided somewhere, and the queue
 * is where the same question about a sale is already answered.
 *
 * Their own entitlement before anybody else's pieces, which is the rule that keeps the pro rata in
 * `transfersOf` honest. Taken off whole drops instead, a holder redeeming exactly their own share of
 * the pile emptied the newest bosses of everything sellable and left the creditor's pieces there
 * unpriceable, while the oldest bosses paid out as though the holder had sold their own half too.
 * That is #281 one level up: 195 kept and 195 sold on a 390 pile settled 105 of a 195-piece debt.
 *
 * Newest first inside each pass, which is the opposite end from a sale, and the reason is the
 * invariant the whole file turns on. Oldest first would take pieces out of the boss at the front of
 * the queue, the one whose debts have already been priced and quite possibly already paid, and
 * un-price them.
 *
 * `holder` is whose pile it is, and absent means every piece reads as theirs, which is one seat
 * having looted the lot.
 *
 * More kept than the pile holds is a miscount rather than a negative pile: every drop ends fully
 * kept and the surplus goes nowhere, which the caller can see by comparing the count to the pile.
 */
export function spreadKept(drops: LedgerDrop[], kept: number, holder?: string): LedgerDrop[] {
  if (kept <= 0) return drops;
  const newestFirst = inQueueOrder(drops).reverse();

  let left = kept;
  const byId = new Map<string, number>();
  const take = (drop: LedgerDrop, upTo: number) => {
    const taken = Math.min(left, upTo);
    if (taken <= 0) return;
    byId.set(drop.id, (byId.get(drop.id) ?? 0) + taken);
    left -= taken;
  };
  for (const drop of newestFirst) take(drop, ownShareOf(drop, holder));
  // Only once their own share is gone. These are pieces they owe somebody, and redeeming them is
  // what `transfersOf` prices at the average their own sales got.
  for (const drop of newestFirst) take(drop, heldOf(drop) - (byId.get(drop.id) ?? 0));

  return drops.map((d) => (byId.has(d.id) ? { ...d, kept: byId.get(d.id) } : d));
}

/**
 * Which sales paid for which drop, oldest boss first.
 *
 * A looter accumulates pieces week after week and sells them in tranches, so "wait until everything
 * has sold" would never come true: next week's clear always adds more. Instead the tranches drain
 * into the queue in order, and a drop is payable as soon as ITS pieces are covered.
 *
 * First cleared, first paid. Drops from the same week are one place in the queue, broken by the
 * boss's own order so the answer never depends on which row was read first.
 *
 * The reason this beats a running average over everything: once a drop is covered, later tranches
 * flow past it into the next one, so its average can never move again. A figure somebody has already
 * been paid stays the figure they were paid, with nothing stored to keep it that way.
 */
export function allocate(drops: LedgerDrop[], sales: PieceSale[]): Map<string, DropCoverage> {
  const queue = inQueueOrder(drops);
  const tranches = sales.map((s) => ({ left: s.pieces, priceEach: s.priceEach }));

  let next = 0;
  const out = new Map<string, DropCoverage>();
  for (const drop of queue) {
    // Against the SELLABLE part of the pile, not the whole drop and not the whole pile: these
    // tranches are one holder's, they can only ever sell the stacks they picked up, and of those
    // only the ones they are not redeeming. A wholly kept pile takes no tranches at all, so the
    // queue flows past it to the next boss rather than stalling behind pieces nobody will list.
    const sellable = sellableOf(drop);
    let covered = 0;
    let cost = 0;
    while (covered < sellable && next < tranches.length) {
      const tranche = tranches[next]!;
      const take = Math.min(sellable - covered, tranche.left);
      covered += take;
      cost += take * tranche.priceEach;
      tranche.left -= take;
      if (tranche.left === 0) next += 1;
    }
    const complete = covered === sellable && sellable > 0;
    out.set(drop.id, {
      covered,
      cost,
      sellable,
      complete,
      averagePrice: complete ? cost / sellable : null,
    });
  }
  return out;
}

/**
 * The transfers that clear one drop, and what each is worth so far.
 *
 * Deterministic on purpose: seats over their share pay seats under it, both in seat order. A stable
 * list is what lets "paid" be remembered against a pair, and it means two people reading the same
 * row are told to send the same things.
 *
 * Empty when the pieces were looted the way they divide, which is the ordinary night. Nothing to
 * say beats a list of zeroes.
 *
 * Every figure is rounded UP, so the person who took somebody else's pieces absorbs the dust rather
 * than the person waiting to be paid. Same rule as the money split, for the same reason.
 */
export function transfersOf(
  drop: LedgerDrop,
  coverage: DropCoverage | undefined,
  /**
   * Only the debts owed BY this seat, for a drop split across several piles.
   *
   * The pairing still runs over every debtor, so who pays whom does not change with which pile is
   * being drawn. Undefined is the whole ledger, which is what one looter holding everything means.
   */
  from?: string,
): PieceTransfer[] {
  const position = balances(drop.total, drop.seats);
  const owing = position.filter((p) => p.balance < 0).map((p) => ({ ...p, left: -p.balance }));
  const owed = position.filter((p) => p.balance > 0).map((p) => ({ ...p, left: p.balance }));

  // What this pile's sold pieces actually fetched. Never a forecast of the unsold ones: a figure
  // over pieces that have not gone yet is a guess at a price nobody has been offered.
  const covered = coverage?.covered ?? 0;
  const sold = coverage?.cost ?? 0;
  const sellable = sellableOf(drop);

  const out: PieceTransfer[] = [];
  let next = 0;
  for (const debtor of owing) {
    while (debtor.left > 0 && next < owed.length) {
      const creditor = owed[next]!;
      const pieces = Math.min(debtor.left, creditor.left);
      // This pair's proportion of the debtor's SELLABLE pile, applied to what has sold so far.
      // Sellable, because that is what their tranches drain and what their own remaining share
      // comes out of. Cumulative, so a payment already made is a prefix of it and never has to be
      // taken back.
      //
      // Over the whole pile instead, a debtor who kept part of theirs paid the creditor only the
      // fraction they chose to sell, and the creditor was never paid for the rest (#281). Over the
      // sellable part it comes out right at every stopping point, including a debtor who keeps
      // their entire share and sells the creditor's: all of that pile is the creditor's, so all of
      // its proceeds are too.
      const send = covered === 0 || sellable === 0 ? null : Math.ceil((sold * pieces) / sellable);
      out.push({
        fromId: debtor.memberId,
        toId: creditor.memberId,
        from: debtor.name,
        to: creditor.name,
        pieces,
        // How many of this pair's pieces the sales so far have reached. Rounded DOWN, so an
        // instalment never claims to have settled a piece that has not sold.
        settled: sellable === 0 ? 0 : Math.min(pieces, Math.floor((covered * pieces) / sellable)),
        send,
        nets: send === null ? null : Math.floor(send * (1 - FEE_STANDARD)),
      });
      debtor.left -= pieces;
      creditor.left -= pieces;
      if (creditor.left === 0) next += 1;
    }
  }
  return from === undefined ? out : out.filter((t) => t.fromId === from);
}

/** The key a transfer is remembered by. One pair, one debt, however the row is redrawn. */
export function transferKey(transfer: { fromId: string; toId: string }): string {
  return `${transfer.fromId}>${transfer.toId}`;
}
