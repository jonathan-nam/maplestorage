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
  /** What the seller is left holding. Carries the rounding dust, see below. */
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
 * Mesos are integers, so each payout is floored and the few mesos of dust land in `sellerKeeps`.
 * The drift is under one meso per member, which is not worth an equalisation pass.
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
  const members = memberFees.map((fee) => {
    const pay =
      method === "fair" ? Math.floor(equalNet / (1 - fee)) : Math.floor(sellerReceives / partySize);
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

/** One line of the worked derivation. */
export type MathStep = {
  /** What this step establishes. */
  title: string;
  /** The general form. */
  formula: string;
  /** The same with this split's own numbers in it. */
  substituted: string;
};

const n = (value: number) => value.toLocaleString("en-US");
const pct = (fee: number) => `${(fee * 100).toFixed(0)}%`;

/**
 * The derivation behind a split, worked with its own numbers.
 *
 * Reads every figure it quotes off the `Split` it is given rather than recomputing them. A
 * hand-written explanation beside a computed number is two sources of truth, and the one nobody
 * runs is the one that goes wrong. A test pins that every payout it computed appears in here.
 */
export function explainSplit(input: SplitInput, split: Split): MathStep[] {
  const { sellerFee, memberFees, method } = input;
  const steps: MathStep[] = [
    split.grossSale !== null
      ? {
          title: "What the sale actually paid you",
          formula: "received = listed x (1 - your fee)",
          substituted: `${n(split.grossSale)} x (1 - ${pct(sellerFee)}) = ${n(split.sellerReceives)}`,
        }
      : {
          title: "What you have to hand out",
          formula: "received = what you entered",
          substituted: `${n(split.sellerReceives)}, so your own fee never enters the split`,
        },
  ];

  if (memberFees.length === 0) {
    steps.push({
      title: "Nobody to pay",
      formula: "you keep = received",
      substituted: n(split.sellerKeeps),
    });
    return steps;
  }

  if (method === "fair") {
    const terms = memberFees.map((fee) => 1 / (1 - fee));
    const divisor = 1 + terms.reduce((sum, t) => sum + t, 0);
    const equalNet = Math.floor(split.sellerReceives / divisor);

    steps.push(
      {
        title: "Everyone is to end up holding the same amount, call it X",
        formula: "X + SUM X / (1 - fee_i) = received",
        substituted:
          "you keep X, and each member must be SENT enough that X survives their own fee",
      },
      {
        title: "So solve that for X",
        formula: "X = received / (1 + SUM 1 / (1 - fee_i))",
        substituted: `${n(split.sellerReceives)} / (1 + ${terms
          .map((t) => t.toFixed(4))
          .join(" + ")}) = ${n(equalNet)}`,
      },
    );

    split.members.forEach((m, i) => {
      steps.push({
        title: `Send member ${i + 1}, who pays ${pct(m.fee)}`,
        formula: "send = X / (1 - fee_i)",
        substituted: `${n(equalNet)} / (1 - ${pct(m.fee)}) = ${n(m.pay)}, of which they keep ${n(m.nets)}`,
      });
    });

    steps.push({
      title: "You keep whatever is left, including the rounding dust",
      formula: "you keep = received - everything sent",
      substituted: `${n(split.sellerReceives)} - ${n(
        split.members.reduce((sum, m) => sum + m.pay, 0),
      )} = ${n(split.sellerKeeps)}`,
    });
  } else {
    const partySize = memberFees.length + 1;
    steps.push({
      title: "Divide what you received by the party, and send that",
      formula: "share = received / party size",
      substituted: `${n(split.sellerReceives)} / ${partySize} = ${n(split.members[0]?.pay ?? 0)}`,
    });

    split.members.forEach((m, i) => {
      steps.push({
        title: `Member ${i + 1} is taxed a second time, at ${pct(m.fee)}`,
        formula: "they keep = share x (1 - fee_i)",
        substituted: `${n(m.pay)} x (1 - ${pct(m.fee)}) = ${n(m.nets)}, which is ${n(
          split.sellerKeeps - m.nets,
        )} less than you keep`,
      });
    });
  }

  const received = split.members.reduce((sum, m) => sum + m.nets, 0);
  steps.push({
    title: "Check: nothing was invented and nothing was lost",
    formula: split.totalFeeCoversSale
      ? "you + everyone else + fees = listed"
      : "you + everyone else + payout fees = received",
    substituted: `${n(split.sellerKeeps)} + ${n(received)} + ${n(split.totalFee)} = ${n(
      split.grossSale ?? split.sellerReceives,
    )}`,
  });

  return steps;
}
