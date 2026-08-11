// How a party splits the coupons, under the boss row that drops them.
//
// A RATE, not a record of a night. The boxes hold stacks per week and a half is a real answer:
// 1.5 a week is three stacks over two, which is what the odd stack rotating already does on its
// own (see suggestArrangement). What is stored is the party's SHARE RATIO, so 1.5 and 1.5 is 1:1
// and 1.5, 0.5 and 1 is 3:1:2. Nothing here divides a stack, and nothing here says who picked one
// up: that is party_loot_bundle, and it is answered on the night.
//
// Read off the CATALOG rather than off a logged drop, so the split can be agreed before the week's
// coupons have fallen, and stays on screen in a week the boss was not run.

import type { BossDrop } from "@/types/drop";
import type { PartyMember } from "@/types/party";

/** What a boss drops at the mode a party runs it, and who is splitting it. */
export type ShareConfig = {
  /** Coupons the boss drops, every clear. */
  quantity: number;
  /** How many equal stacks they fall in. */
  bundles: number;
  /** Coupons in one stack. */
  size: number;
  /** The seats splitting them, your own character among them. */
  seats: PartyMember[];
};

/**
 * The split under this boss row, or null when there is nothing to divide.
 *
 * Null, each for its own reason:
 *
 *  - the boss drops no coupon at this mode, or nobody has said which mode the party runs.
 *  - the catalog has not counted the stacks, which is not a claim that it falls in one.
 *  - one seat, or none. A split needs two sides.
 */
export function shareConfig(
  table: BossDrop[] | undefined,
  difficulty: string | null,
  dropKey: string,
  seats: PartyMember[],
): ShareConfig | null {
  if (!table || difficulty === null || seats.length < 2) return null;
  const drop = table.find((row) => row.dropKey === dropKey);
  const quantity = drop?.pieces?.[difficulty];
  const bundles = drop?.bundles?.[difficulty];
  if (!quantity || !bundles) return null;
  return { quantity, bundles, size: quantity / bundles, seats };
}

/** What the seats' shares add up to. The denominator every figure below is a fraction of. */
function weightOf(seats: PartyMember[]): number {
  return seats.reduce((sum, seat) => sum + seat.shares, 0);
}

/**
 * Stacks a week each seat's share comes to, by seat id. A half is ordinary.
 *
 * The number the boxes hold. A duo on 1:1 splitting three stacks is 1.5 each, which no single week
 * can hand out and every fortnight can: the odd stack rotates, and this is that arrangement said as
 * one figure instead of as an alternation nobody can read off a share.
 */
export function stacksPerWeek(config: ShareConfig): Map<string, number> {
  const weight = weightOf(config.seats);
  const out = new Map<string, number>();
  if (weight <= 0) return out;
  for (const seat of config.seats) out.set(seat.id, (config.bundles * seat.shares) / weight);
  return out;
}

/** Coupons a week each seat's share comes to. What the stacks are worth, said in the unit people use. */
export function piecesPerWeek(config: ShareConfig): Map<string, number> {
  const weight = weightOf(config.seats);
  const out = new Map<string, number>();
  if (weight <= 0) return out;
  for (const seat of config.seats) out.set(seat.id, (config.quantity * seat.shares) / weight);
  return out;
}

/**
 * The share ratio a set of per-week stack figures comes to, or null when they are not a split.
 *
 * Doubled first, because a half is the finest thing anybody types and doubling makes every one of
 * them whole; then reduced, so 3:3 is stored as 1:1. Storing the doubled figures would work and
 * would make "2 shares" mean something different on every boss, which is the sort of number that
 * reads wrong the first time somebody opens the party editor.
 *
 * Null when a figure is not a whole number of half stacks, or when they come to nothing at all: a
 * ratio of zeroes divides nothing and would make every entitlement a division by zero.
 */
export function sharesFromStacks(stacks: Map<string, number>): Map<string, number> | null {
  const doubled = new Map<string, number>();
  for (const [id, value] of stacks) {
    const halves = value * 2;
    if (!Number.isInteger(halves) || halves < 0) return null;
    doubled.set(id, halves);
  }
  const total = [...doubled.values()].reduce((sum, n) => sum + n, 0);
  if (total <= 0) return null;

  const divisor = [...doubled.values()].reduce(greatestCommonDivisor, 0);
  return new Map([...doubled].map(([id, n]) => [id, n / divisor]));
}

/** Euclid. Zero is the identity here, which is what lets a seat on none sit in the fold. */
function greatestCommonDivisor(a: number, b: number): number {
  return b === 0 ? a : greatestCommonDivisor(b, a % b);
}

/**
 * A box's value as stacks, or null when it is not one.
 *
 * Halves and whole numbers, and ".5" as well as "0.5", which is how somebody types it. Blank is
 * none, which is a real answer: a seat that takes nothing out of this boss.
 */
export function parseStacks(value: string): number | null {
  const text = value.trim();
  if (text === "") return 0;
  if (!/^\d*\.?\d+$/.test(text)) return null;
  const parsed = Number(text);
  // Halves are exact in binary, so this comparison is safe and no rounding creeps in.
  if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed * 2)) return null;
  return parsed;
}

/** How a stack figure is written: whole where it is whole, one place where it is a half. */
export function stacksLabel(stacks: number): string {
  return Number.isInteger(stacks) ? String(stacks) : stacks.toFixed(1);
}
