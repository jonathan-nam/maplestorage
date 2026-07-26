// Turning a recorded sale into what each member is owed.
//
// The arithmetic is NOT here. It is splitDrop() in lib/drop-split.ts, with its 64 tests, and this
// file only feeds it: the party's MVP flags become fee rates, the stored basis and method become
// its input, and the payout rows say who is in it. A second implementation of the split is the one
// thing this feature must not grow, because two answers to "what do I send you" is worse than none.

import { FEE_MVP, FEE_STANDARD, type Split, splitDrop } from "./drop-split";
import type { Loot } from "@/types/loot";
import type { PartyMember } from "@/types/party";

/** The Auction House rate this member pays on a payout hop. */
export function memberFee(mvp: boolean): number {
  return mvp ? FEE_MVP : FEE_STANDARD;
}

export type Share = {
  memberId: string;
  name: string;
  fee: number;
  /** Mesos to send them, before the fee on that transfer. */
  pay: number;
  /** What they end up holding. */
  nets: number;
  paid: boolean;
};

export type LootSplit = {
  seller: { memberId: string; name: string; keeps: number };
  shares: Share[];
  split: Split;
};

/**
 * What this sold drop owes each member, or null when it cannot be worked out.
 *
 * Null rather than a partial answer in three cases: the drop is not sold, the seller is no longer
 * a seat we can read a fee from, or a payout names a seat that is not in the party. Each would
 * otherwise produce a payout list that looks complete and is short a person or wrong on a rate.
 */
export function splitOf(loot: Loot, members: PartyMember[]): LootSplit | null {
  if (
    loot.saleAmount === null ||
    loot.sellerMemberId === null ||
    loot.amountBasis === null ||
    loot.splitMethod === null
  ) {
    return null;
  }

  const byId = new Map(members.map((m) => [m.id, m]));
  const seller = byId.get(loot.sellerMemberId);
  if (!seller) return null;

  const owed = loot.payouts.map((payout) => ({ payout, member: byId.get(payout.memberId) }));
  if (owed.some((o) => !o.member)) return null;

  const split = splitDrop({
    amount: loot.saleAmount,
    amountIs: loot.amountBasis === "LISTED" ? "listed" : "received",
    sellerFee: memberFee(seller.mvp),
    memberFees: owed.map((o) => memberFee(o.member!.mvp)),
    method: loot.splitMethod === "FAIR" ? "fair" : "lazy",
  });

  return {
    seller: { memberId: seller.id, name: seller.name, keeps: split.sellerKeeps },
    shares: owed.map((o, i) => ({
      memberId: o.payout.memberId,
      name: o.member!.name,
      fee: split.members[i]?.fee ?? 0,
      pay: split.members[i]?.pay ?? 0,
      nets: split.members[i]?.nets ?? 0,
      paid: o.payout.paid,
    })),
    split,
  };
}

export type LootSummary = {
  /** Dropped, not sold yet. */
  pending: number;
  /** Sold, with somebody still unpaid. */
  awaitingPayout: number;
};

/** The two counts a party card shows: what is unsold, and what is sold but not settled. */
export function summarize(loot: Loot[]): LootSummary {
  return {
    pending: loot.filter((l) => l.status === "PENDING").length,
    awaitingPayout: loot.filter((l) => l.status === "SOLD").length,
  };
}

/** The status as a short label. Kept beside summarize so the two cannot disagree. */
export function statusLabel(status: string): string {
  if (status === "PENDING") return "In the pool";
  if (status === "SOLD") return "Awaiting payout";
  if (status === "PAID_OUT") return "Settled";
  return status;
}

/**
 * The date as written, not as a timezone reads it.
 *
 * new Date("2026-07-20") is UTC midnight, so anyone behind UTC sees the 19th. Same reasoning as
 * formatPeriod in lib/boss-clears.ts.
 */
export function formatDropped(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  const months = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");
  return `${day} ${months[month - 1]}`;
}
