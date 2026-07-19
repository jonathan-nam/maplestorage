// Splitting boss drop money, and the tax that makes it not-division.
//
// The Auction House takes a cut of every sale: 5%, or 3% for MVP. One person sells the drop and
// pays that once. If they then pay the party through the AH, every meso a member receives has
// been taxed TWICE and the seller's own share only once. Naive division looks fair and is not.
//
//   lazy  the seller divides what landed in their inventory by the party size and sends that.
//         Cheap to reason about, and the seller quietly keeps a whole fee more than everyone else.
//   fair  the seller sends each member more than they keep, sized so that AFTER the second tax
//         every member nets exactly what the seller kept.
//
// Both are offered because "lazy" is what most parties actually do, and a tool that only showed
// the fair number could not tell you what it was costing you.
//
// The fee on the PAYOUT hop is the RECEIVING member's, not the seller's: to move mesos through the
// AH the member lists and the seller buys, so it is the member who is selling and the member whose
// MVP status applies. Hence a rate per member rather than one rate for the room.

/** The two rates the Auction House charges. MVP pays the lower one. */
export const FEE_MVP = 0.03;
export const FEE_STANDARD = 0.05;

export type SplitMethod = "lazy" | "fair";

export type SplitInput = {
  /** What the drop was LISTED at, before any fee. */
  salePrice: number;
  /** The seller's own rate, charged on the sale. */
  sellerFee: number;
  /** One rate per OTHER party member. Its length is the party size less the seller. */
  memberFees: number[];
  method: SplitMethod;
};

export type MemberShare = {
  fee: number;
  /** Mesos to send this member, before the fee on that transfer. */
  pay: number;
  /** What they actually end up holding. */
  nets: number;
};

export type Split = {
  /** Sale price less the fee on the sale. This is what the seller has to hand out. */
  sellerReceives: number;
  /** What the seller is left holding. Carries the rounding dust, see below. */
  sellerKeeps: number;
  members: MemberShare[];
  /** Total lost to the AH across both hops. */
  totalFee: number;
};

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
 * Throws on a rate outside [0, 1) or a negative price rather than returning a number nobody should
 * act on. A rate of 1 would mean the AH takes everything, and dividing by what is left is where an
 * Infinity would enter and be rendered as a payout.
 *
 * Mesos are integers, so each payout is floored and the few mesos of dust land in `sellerKeeps`.
 * The drift is under one meso per member, which is not worth an equalisation pass.
 */
export function splitDrop({ salePrice, sellerFee, memberFees, method }: SplitInput): Split {
  for (const fee of [sellerFee, ...memberFees]) {
    if (!Number.isFinite(fee) || fee < 0 || fee >= 1) {
      throw new RangeError(`fee must be at least 0 and below 1, got ${fee}`);
    }
  }
  if (!Number.isFinite(salePrice) || salePrice < 0) {
    throw new RangeError(`sale price must be zero or more, got ${salePrice}`);
  }

  const gross = Math.floor(salePrice);
  const sellerReceives = Math.floor(gross * (1 - sellerFee));

  // Fair, with a rate per member. Everyone is to hold the same amount X afterwards, so the seller
  // keeps X and must send member i enough that X survives THEIR fee, X / (1 - fee_i). Those have
  // to add up to what the seller is holding:
  //   X + Σ X / (1 - fee_i) = received
  // so X = received / (1 + Σ 1 / (1 - fee_i)). With one shared rate this collapses to the flat
  // formula, which is what the equal-rate tests pin.
  const equalNet = sellerReceives / (1 + memberFees.reduce((sum, fee) => sum + 1 / (1 - fee), 0));

  const partySize = memberFees.length + 1;
  const members = memberFees.map((fee) => {
    const pay =
      method === "fair" ? Math.floor(equalNet / (1 - fee)) : Math.floor(sellerReceives / partySize);
    return { fee, pay, nets: Math.floor(pay * (1 - fee)) };
  });

  const paidOut = members.reduce((sum, m) => sum + m.pay, 0);
  const sellerKeeps = sellerReceives - paidOut;
  const received = members.reduce((sum, m) => sum + m.nets, 0);

  return { sellerReceives, sellerKeeps, members, totalFee: gross - sellerKeeps - received };
}
