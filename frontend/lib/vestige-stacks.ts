// Handing out one night's coupons, under the boss row that dropped them.
//
// A STACK is the unit and the only unit. Hard Baldrix gives 120 in 3 stacks of 40, and a stack is
// what one person bent down for, so what a member can be handed is a whole number of them and
// nothing finer. The boxes hold stacks for that reason; the pieces are shown under them, because
// the pieces are the number people say to each other.
//
// Nothing here divides a stack, and nothing here stores a share. What is written is party_loot_bundle
// (V41): which seat picked up how many. Every figure anybody is owed follows from that on read.

import { foldSeats, holderKey, holderOf, ranSeats, suggestArrangement } from "./vestige-ledger";
import type { Loot } from "@/types/loot";
import type { Party, PartyMember } from "@/types/party";

/** One night's coupons, ready to be handed out. */
export type StackDrop = {
  lootId: string;
  /** What FELL, never a share. See V40. */
  quantity: number;
  /** How many equal stacks it fell in. */
  bundles: number;
  /** Pieces in one stack. Whole by construction: the catalog refuses a total its stacks do not divide. */
  size: number;
  /** The seats that ran the week it fell in, which is who a stack may be handed to. */
  seats: PartyMember[];
  /**
   * An arrangement is already recorded and can be read against those seats.
   *
   * What makes Save a correction rather than a first answer. False when it cannot be read, which
   * happens when the week's roster was edited afterwards and the arrangement names somebody the week
   * no longer has: that has to be said again rather than drawn as an arrangement nobody entered.
   */
  recorded: boolean;
  /** The stacks each seat is recorded as picking up. Empty when nobody has said. */
  counts: Record<string, number>;
};

/**
 * The nights among these drops that can still be handed out.
 *
 * Takes the rows the panel is ALREADY showing rather than narrowing to a week itself, so the boxes
 * cover exactly what is listed above them. Two narrowings would differ the first time one of them
 * changed, and the gap would be a drop on screen with no way to say who took it. See dropsInWeek.
 *
 * Left out, each for its own reason:
 *
 *  - a drop that is not this coupon.
 *  - one already sold or taken, whose payouts were pinned from the roster that ran it.
 *  - one that falls in a single stack, which cannot be shared however anybody agreed.
 *  - a night that folds to ONE holder. One person's three characters took three stacks and all
 *    three are still theirs, so there is nothing to hand out and no debt to get wrong.
 */
export function assignableDrops(party: Party, loot: Loot[], dropKey: string): StackDrop[] {
  const drops: StackDrop[] = [];

  for (const row of loot) {
    if (row.dropKey !== dropKey || row.quantity < 1) continue;
    if (row.soldAt !== null || row.takenByMemberId !== null) continue;
    const bundles = row.bundles ?? 0;
    if (bundles < 2) continue;

    const seats = ranSeats(row, party);
    if (foldSeats(seats).length < 2) continue;

    const counts: Record<string, number> = {};
    for (const b of row.bundlesBy) counts[b.memberId] = b.bundles;
    // Readable only when the recorded stacks all belong to seats that ran and add up to what fell.
    const recorded =
      row.bundlesBy.length > 0 &&
      seats.reduce((sum, s) => sum + (counts[s.id] ?? 0), 0) === bundles;

    drops.push({
      lootId: row.id,
      quantity: row.quantity,
      bundles,
      size: row.quantity / bundles,
      seats,
      recorded,
      counts: recorded ? counts : {},
    });
  }
  return drops;
}

/**
 * How many stacks each seat's box opens on.
 *
 * The order heldByHolder reads in, so the boxes show what the app already believes rather than a
 * fresh guess laid over the top of it:
 *
 *  - the arrangement recorded, so a wrong one is corrected rather than only added to.
 *  - the party's agreed looter holding the lot, which is what naming one means.
 *  - the balanced split, odd stack to whoever is furthest behind.
 *
 * A suggestion in the last two cases and never a stored one: the balance moves when an earlier week
 * is edited, and a guess written down would rewrite nights already settled. Nothing is saved until
 * somebody presses the button.
 */
export function openingCounts(
  drop: StackDrop,
  party: Party,
  behind: Map<string, number>,
): Record<string, number> {
  if (drop.recorded) return { ...drop.counts };

  // Only when that seat actually ran. A looter who sat the week out cannot have picked anything up,
  // and opening on them would suggest a night that did not happen.
  const looter = drop.seats.find((s) => s.id === party.looterMemberId);
  if (looter) return { [looter.id]: drop.bundles };

  const suggested = suggestArrangement(drop.bundles, drop.seats, behind);
  return Object.fromEntries(drop.seats.map((s) => [s.id, suggested.get(s.id) ?? 0]));
}

/** What the boxes come to. Compared against the stacks that fell, which is the only rule there is. */
export function assignedStacks(counts: Record<string, number>): number {
  return Object.values(counts).reduce((sum, n) => sum + n, 0);
}

/**
 * The arrangement as the server takes it: seat id to stacks, with the empty-handed left out.
 *
 * A seat on zero is ABSENT rather than sent a zero, which the server refuses: somebody who did not
 * bend down is not present with none.
 */
export function stacksToSave(counts: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 0));
}

/** What one person picked up, and what they were owed, both in PIECES. */
export type Tally = {
  /** Pieces the boxes give them: their stacks times the stack size. */
  took: number;
  /** Pieces their share comes to out of what fell. */
  due: number;
};

/**
 * What each holder took and what they were due, in PIECES.
 *
 * Both numbers, not the difference between them. The difference alone said a member was 60 over
 * without ever saying 60 out of WHAT, so a row could not be checked against what actually happened:
 * "he has 120 and he was owed 60" is the sentence somebody says out loud, and neither half of it
 * can be worked out from the other.
 *
 * Measured per HOLDER and reported against every seat of theirs, both halves alike. Two characters
 * of one person net out against each other rather than reading as one owed and one owing, and a
 * person who brings two characters is due twice as much and due it once.
 */
export function pieceTallies(drop: StackDrop, counts: Record<string, number>): Map<string, Tally> {
  const holders = foldSeats(drop.seats);
  const weight = holders.reduce((sum, h) => sum + h.shares, 0);
  const tallies = new Map<string, Tally>();
  if (weight <= 0) return tallies;

  const took = new Map<string, number>();
  for (const seat of drop.seats) {
    const key = holderKey(holderOf(seat));
    took.set(key, (took.get(key) ?? 0) + (counts[seat.id] ?? 0) * drop.size);
  }
  for (const holder of holders) {
    tallies.set(holder.key, {
      took: took.get(holder.key) ?? 0,
      due: (drop.quantity * holder.shares) / weight,
    });
  }
  return tallies;
}
