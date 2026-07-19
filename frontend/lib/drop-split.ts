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

/**
 * Which end of the sale the entered figure is.
 *
 * `received` makes `sellerFee` irrelevant: the fee only ever existed to turn a listed price into
 * what landed in your inventory, and if you type the latter there is nothing left for it to do.
 * The gross is NOT inferred back from it, because that would put a figure on screen the tool was
 * told, not shown.
 */
export type AmountBasis = "listed" | "received";

export type SplitInput = {
  /** The figure entered, read according to `amountIs`. */
  amount: number;
  amountIs: AmountBasis;
  /** The seller's own rate, charged on the sale. Ignored when `amountIs` is `received`. */
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
  /** What the drop was listed at, or null when only the received figure is known. */
  grossSale: number | null;
  /** What the seller has to hand out. */
  sellerReceives: number;
  /** What the seller is left holding, after absorbing the rounding dust. */
  sellerKeeps: number;
  members: MemberShare[];
  /** Lost to the AH: both hops when the listed price is known, the payouts alone when it is not. */
  totalFee: number;
  /** False when `totalFee` covers the payouts only, so a caller cannot label it as the whole cost. */
  totalFeeCoversSale: boolean;
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
 * Mesos are integers, so each payout is rounded UP and the seller absorbs the dust. It is a meso
 * per member at most, and it is the distributor's to eat rather than the party's.
 */
export function splitDrop({ amount, amountIs, sellerFee, memberFees, method }: SplitInput): Split {
  // The seller's own rate is unused on a `received` basis, so a nonsense value there must not
  // reject input the split does not depend on.
  const rates = amountIs === "listed" ? [sellerFee, ...memberFees] : memberFees;
  for (const fee of rates) {
    if (!Number.isFinite(fee) || fee < 0 || fee >= 1) {
      throw new RangeError(`fee must be at least 0 and below 1, got ${fee}`);
    }
  }
  if (!Number.isFinite(amount) || amount < 0) {
    throw new RangeError(`amount must be zero or more, got ${amount}`);
  }

  const entered = Math.floor(amount);
  const grossSale = amountIs === "listed" ? entered : null;
  const sellerReceives = amountIs === "listed" ? Math.floor(entered * (1 - sellerFee)) : entered;

  // Fair, with a rate per member. Everyone is to hold the same amount X afterwards, so the seller
  // keeps X and must send member i enough that X survives THEIR fee, X / (1 - fee_i). Those have
  // to add up to what the seller is holding:
  //   X + SUM X / (1 - fee_i) = received
  // so X = received / (1 + SUM 1 / (1 - fee_i)). With one shared rate this collapses to the flat
  // formula, which is what the equal-rate tests pin.
  const equalNet = sellerReceives / (1 + memberFees.reduce((sum, fee) => sum + 1 / (1 - fee), 0));

  const partySize = memberFees.length + 1;
  const exact = (fee: number) =>
    method === "fair" ? equalNet / (1 - fee) : sellerReceives / partySize;
  const payouts = (round: (n: number) => number) => memberFees.map((fee) => round(exact(fee)));

  // Round payouts UP, so the seller absorbs the rounding dust rather than the party. It is a meso
  // or two, but it is the distributor's to eat, and it matches the split bot people already
  // cross-check against.
  //
  // Rounding up can OVERSHOOT what the seller is holding, though only on amounts too small to
  // divide: 1 meso across a party of 6 rounds to 1 each and pays out 5 from a purse of 1. Falling
  // back to floor is the only branch where the invariant would otherwise break.
  let pays = payouts(Math.ceil);
  if (pays.reduce((sum, p) => sum + p, 0) > sellerReceives) pays = payouts(Math.floor);

  const members = memberFees.map((fee, i) => {
    const pay = pays[i] ?? 0;
    return { fee, pay, nets: Math.floor(pay * (1 - fee)) };
  });

  const paidOut = members.reduce((sum, m) => sum + m.pay, 0);
  const sellerKeeps = sellerReceives - paidOut;
  const received = members.reduce((sum, m) => sum + m.nets, 0);

  return {
    grossSale,
    sellerReceives,
    sellerKeeps,
    members,
    totalFee: (grossSale ?? sellerReceives) - sellerKeeps - received,
    totalFeeCoversSale: grossSale !== null,
  };
}

/** One line of the working: a name, and the arithmetic that produced it. */
export type MathStep = {
  /** What is being computed. */
  label: string;
  /** The arithmetic, with this split's own numbers and its result. */
  expression: string;
};

const n = (value: number) => value.toLocaleString("en-US");
const keptOf = (fee: number) => (1 - fee).toFixed(2);

/**
 * The arithmetic behind a split, in the order it was done.
 *
 * Reads every figure off the `Split` it is given rather than recomputing them. A hand-written
 * explanation beside a computed number is two sources of truth, and the one nobody runs is the
 * one that goes wrong. A test pins that every payout it computed appears in here.
 */
export function explainSplit(input: SplitInput, split: Split): MathStep[] {
  const { sellerFee, memberFees, method } = input;
  const others = memberFees.length;
  const steps: MathStep[] = [
    {
      label: "received",
      expression:
        split.grossSale !== null
          ? `${n(split.grossSale)} x ${keptOf(sellerFee)} = ${n(split.sellerReceives)}`
          : `${n(split.sellerReceives)} (entered)`,
    },
  ];

  if (others === 0) {
    steps.push({ label: "you keep", expression: n(split.sellerKeeps) });
    return steps;
  }

  const uniform = memberFees.every((fee) => fee === memberFees[0]);
  const fee = memberFees[0] ?? 0;
  const paidOut = split.members.reduce((sum, m) => sum + m.pay, 0);
  const netted = split.members.reduce((sum, m) => sum + m.nets, 0);

  if (method === "fair") {
    const divisor = 1 + memberFees.reduce((sum, f) => sum + 1 / (1 - f), 0);
    steps.push({
      label: "X",
      expression: uniform
        ? `${n(split.sellerReceives)} / (1 + ${others} / ${keptOf(fee)}) = ${n(
            Math.floor(split.sellerReceives / divisor),
          )}`
        : `${n(split.sellerReceives)} / ${divisor.toFixed(4)} = ${n(
            Math.floor(split.sellerReceives / divisor),
          )}`,
    });
  }

  // One line for the party when they all pay the same, which is the usual case. Only a mixed
  // party needs a line each, and then the rate has to be in it or the numbers look arbitrary.
  if (uniform) {
    steps.push(
      {
        label: "send each",
        expression:
          method === "fair"
            ? `${n(Math.floor(split.sellerReceives / (1 + memberFees.reduce((sum, f) => sum + 1 / (1 - f), 0))))} / ${keptOf(fee)} = ${n(split.members[0]?.pay ?? 0)}`
            : `${n(split.sellerReceives)} / ${others + 1} = ${n(split.members[0]?.pay ?? 0)}`,
      },
      {
        label: "they keep",
        expression: `${n(split.members[0]?.pay ?? 0)} x ${keptOf(fee)} = ${n(split.members[0]?.nets ?? 0)}`,
      },
    );
  } else {
    split.members.forEach((m, i) => {
      steps.push({
        label: `member ${i + 1}`,
        expression: `send ${n(m.pay)} x ${keptOf(m.fee)} = ${n(m.nets)}`,
      });
    });
  }

  steps.push({
    label: "you keep",
    expression: uniform
      ? `${n(split.sellerReceives)} - ${others} x ${n(split.members[0]?.pay ?? 0)} = ${n(split.sellerKeeps)}`
      : `${n(split.sellerReceives)} - ${n(paidOut)} = ${n(split.sellerKeeps)}`,
  });

  steps.push({
    label: "check",
    expression: `${n(split.sellerKeeps)} + ${n(netted)} + ${n(split.totalFee)} = ${n(
      split.grossSale ?? split.sellerReceives,
    )}`,
  });

  return steps;
}
