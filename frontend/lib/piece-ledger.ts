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
   * Pro rata: every piece that sells pays out in the split's own proportion, so a debt is cleared in
   * instalments as the stack goes rather than in one payment at the end. It comes to exactly the
   * same money either way. What it avoids is the receiver waiting on the last piece of a stack that
   * may sit for weeks, and no instalment is ever revised, because each one is settled against the
   * price its own tranches really got.
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
 * What each seat was entitled to, by the largest remainder.
 *
 * Pieces are whole, so a share of them usually is not: 181 across four is 45.25 each. Everyone gets
 * the floor, then the odd pieces go to the biggest fractions, ties in seat order. The point is that
 * the entitlements add up to exactly what dropped, which is what makes the balances below sum to
 * zero and the transfers clear the ledger completely rather than nearly.
 */
export function entitlements(total: number, seats: LedgerSeat[]): Map<string, number> {
  const weight = seats.reduce((sum, s) => sum + s.shares, 0);
  if (seats.length === 0 || weight <= 0 || total <= 0) {
    return new Map(seats.map((s) => [s.memberId, 0]));
  }

  const exact = seats.map((s) => (total * s.shares) / weight);
  const floors = exact.map(Math.floor);
  let left = total - floors.reduce((sum, n) => sum + n, 0);

  // Biggest fraction first, seat order breaking ties, so the same ledger always produces the same
  // entitlements and a transfer already paid does not move to a different pair on the next read.
  const order = seats
    .map((_, i) => ({ i, fraction: (exact[i] ?? 0) - (floors[i] ?? 0) }))
    .sort((a, b) => b.fraction - a.fraction || a.i - b.i);

  const share = [...floors];
  for (const { i } of order) {
    if (left <= 0) break;
    share[i] = (share[i] ?? 0) + 1;
    left -= 1;
  }
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
  total: number;
  seats: LedgerSeat[];
};

/** How much of one drop the sales so far have covered, and what those pieces fetched. */
export type DropCoverage = {
  covered: number;
  /** Listed value of the covered pieces, at the prices they actually went for. */
  cost: number;
  /** Every piece of it has sold, so nothing about it can move again. */
  complete: boolean;
  /** Weighted average listed price of the pieces that covered it. Null until it is covered. */
  averagePrice: number | null;
};

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
  const queue = [...drops].sort(
    (a, b) =>
      a.weekStart.localeCompare(b.weekStart) || a.order - b.order || a.id.localeCompare(b.id),
  );
  const tranches = sales.map((s) => ({ left: s.pieces, priceEach: s.priceEach }));

  let next = 0;
  const out = new Map<string, DropCoverage>();
  for (const drop of queue) {
    let covered = 0;
    let cost = 0;
    while (covered < drop.total && next < tranches.length) {
      const tranche = tranches[next]!;
      const take = Math.min(drop.total - covered, tranche.left);
      covered += take;
      cost += take * tranche.priceEach;
      tranche.left -= take;
      if (tranche.left === 0) next += 1;
    }
    const complete = covered === drop.total && drop.total > 0;
    out.set(drop.id, {
      covered,
      cost,
      complete,
      averagePrice: complete ? cost / drop.total : null,
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
export function transfersOf(drop: LedgerDrop, coverage: DropCoverage | undefined): PieceTransfer[] {
  const position = balances(drop.total, drop.seats);
  const owing = position.filter((p) => p.balance < 0).map((p) => ({ ...p, left: -p.balance }));
  const owed = position.filter((p) => p.balance > 0).map((p) => ({ ...p, left: p.balance }));

  // What this drop's sold pieces actually fetched. Never a forecast of the unsold ones: a figure
  // over pieces that have not gone yet is a guess at a price nobody has been offered.
  const covered = coverage?.covered ?? 0;
  const sold = coverage?.cost ?? 0;

  const out: PieceTransfer[] = [];
  let next = 0;
  for (const debtor of owing) {
    while (debtor.left > 0 && next < owed.length) {
      const creditor = owed[next]!;
      const pieces = Math.min(debtor.left, creditor.left);
      // This pair's proportion of the drop, applied to what has sold so far. Cumulative, so a
      // payment already made is a prefix of it and never has to be taken back.
      const send = covered === 0 ? null : Math.ceil((sold * pieces) / drop.total);
      out.push({
        fromId: debtor.memberId,
        toId: creditor.memberId,
        from: debtor.name,
        to: creditor.name,
        pieces,
        // How many of this pair's pieces the sales so far have reached. Rounded DOWN, so an
        // instalment never claims to have settled a piece that has not sold.
        settled: Math.min(pieces, Math.floor((covered * pieces) / drop.total)),
        send,
        nets: send === null ? null : Math.floor(send * (1 - FEE_STANDARD)),
      });
      debtor.left -= pieces;
      creditor.left -= pieces;
      if (creditor.left === 0) next += 1;
    }
  }
  return out;
}

/** The key a transfer is remembered by. One pair, one debt, however the row is redrawn. */
export function transferKey(transfer: { fromId: string; toId: string }): string {
  return `${transfer.fromId}>${transfer.toId}`;
}
