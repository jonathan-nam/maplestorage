// Splitting boss drop money, and the tax that makes it not-division.
//
// The Auction House takes 3% of every sale. One person sells the drop and pays that tax once. If
// they then pay the party through the AH as well, every meso a party member receives has been
// taxed TWICE and the seller's own share only once. Naive division looks fair and is not.
//
//   lazy  the seller divides what landed in their inventory by the party size and sends that.
//         Cheap to reason about, and the seller quietly keeps ~3% more than everyone else.
//   fair  the seller sends more than they keep, sized so that AFTER the second tax every member
//         nets exactly what the seller kept.
//
// Both are offered because "lazy" is what most parties actually do, and a tool that only shows the
// fair number cannot tell you what it is costing you.

/** Auction House cut on every transaction, as a fraction of the sale price. */
export const AUCTION_HOUSE_FEE = 0.03;

const KEPT = 1 - AUCTION_HOUSE_FEE;

export type SplitMethod = "lazy" | "fair";

export type SplitInput = {
  /** What the drop sold for on the Auction House, before the fee. */
  salePrice: number;
  /** Everyone entitled to a share, INCLUDING the seller. */
  partySize: number;
  method: SplitMethod;
};

export type Split = {
  /** Sale price less the fee on the sale. This is what the seller has to hand out. */
  sellerReceives: number;
  /** Mesos to send to each of the other members, before the fee on that transfer. */
  payEach: number;
  /** What one of those members actually ends up with. */
  eachNets: number;
  /** What the seller is left holding. Carries the rounding dust, see below. */
  sellerKeeps: number;
  /** Total lost to the AH across both hops. */
  totalFee: number;
};

const afterFee = (mesos: number) => Math.floor(mesos * KEPT);

const SUFFIX: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9 };

/**
 * Reads a sale price the way a player would say it: `1b`, `9.5b`, `970m`, `1,000,000,000`.
 *
 * Returns null for anything it cannot read, INCLUDING partial input, so the caller shows nothing
 * rather than a number derived from half a figure. Boss drops are nine and ten digit numbers and
 * typing one out in full is where a zero goes missing.
 */
export function parseMesos(input: string): number | null {
  const cleaned = input
    .trim()
    .toLowerCase()
    .replace(/[,_\s]/g, "");
  if (cleaned === "") return null;
  const match = /^(\d+(?:\.\d+)?)([kmb])?$/.exec(cleaned);
  if (!match?.[1]) return null;
  const suffix = match[2];
  const value = Number(match[1]) * (suffix ? (SUFFIX[suffix] ?? 1) : 1);
  return Number.isFinite(value) ? Math.round(value) : null;
}

/**
 * Throws on a party size below 1 or a negative price rather than returning a number nobody should
 * act on.
 *
 * Mesos are integers, so `payEach` is floored and the few mesos of dust land in `sellerKeeps`. The
 * drift is under one meso per member, which is not worth an equalisation pass.
 */
export function splitDrop({ salePrice, partySize, method }: SplitInput): Split {
  if (!Number.isInteger(partySize) || partySize < 1) {
    throw new RangeError(`party size must be a whole number of at least 1, got ${partySize}`);
  }
  if (!Number.isFinite(salePrice) || salePrice < 0) {
    throw new RangeError(`sale price must be zero or more, got ${salePrice}`);
  }

  const sellerReceives = afterFee(Math.floor(salePrice));
  const others = partySize - 1;

  // Solving `sellerKeeps === eachNets` for the fair case:
  //   keeps + others * pay = received       (the seller hands out everything they hold)
  //   keeps = pay * KEPT                    (a member nets the same as the seller keeps)
  // gives pay = received / (KEPT + others). The lazy case is the division the name promises.
  const payEach =
    others === 0
      ? 0
      : method === "fair"
        ? Math.floor(sellerReceives / (KEPT + others))
        : Math.floor(sellerReceives / partySize);

  const sellerKeeps = sellerReceives - others * payEach;

  return {
    sellerReceives,
    payEach,
    eachNets: afterFee(payEach),
    sellerKeeps,
    totalFee: Math.floor(salePrice) - sellerKeeps - others * afterFee(payEach),
  };
}
