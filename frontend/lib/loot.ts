// Turning a recorded sale into what each member is owed.
//
// The arithmetic is NOT here. It is splitDrop() in lib/drop-split.ts, with its 64 tests, and this
// file only feeds it: the party's MVP flags become fee rates, the stored basis and method become
// its input, and the payout rows say who is in it. A second implementation of the split is the one
// thing this feature must not grow, because two answers to "what do I send you" is worse than none.

import { type AmountBasis, FEE_STANDARD, type Split, splitDrop } from "./drop-split";
import type { Loot } from "@/types/loot";
import type { PartyMember } from "@/types/party";

/**
 * The Auction House rate a member pays on a payout hop.
 *
 * The standard rate for everybody: MVP tiers are not tracked any more, so there is nothing to read
 * a 3% off. That is the honest reading of what is stored rather than a claim that nobody is MVP,
 * and it means a split can only under-state what a member nets, never over-state it.
 */
export function memberFee(): number {
  return FEE_STANDARD;
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
  /**
   * The seat the shares are measured from: who sold it, or who bought it off the party. `keeps` is
   * mesos on a sale and the value of their own share of the item on a buy.
   */
  seller: { memberId: string; name: string; keeps: number };
  shares: Share[];
  split: Split;
};

/**
 * How to read the stored figure, or null for a basis this build does not know.
 *
 * BOUGHT is a party member buying the drop off the party. Nothing was listed, so no Auction House
 * cut came off the top and the whole figure is the pot, which is `received`'s arithmetic exactly.
 * The payout hops are still taxed, so the split itself is unchanged.
 *
 * Null rather than a default, because defaulting an unknown basis to `received` would silently
 * skip a fee on a row written by a newer build.
 */
function basisOf(stored: string): AmountBasis | null {
  if (stored === "LISTED") return "listed";
  if (stored === "RECEIVED" || stored === "BOUGHT") return "received";
  return null;
}

/**
 * What this sold drop owes each member, or null when it cannot be worked out.
 *
 * Null rather than a partial answer in four cases: the drop is not sold, its basis is one this
 * build cannot read, the seller is no longer a seat we can read a fee from, or a payout names a
 * seat that is not in the party. Each would otherwise produce a payout list that looks complete
 * and is short a person or wrong on a rate.
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

  const amountIs = basisOf(loot.amountBasis);
  if (amountIs === null) return null;

  const byId = new Map(members.map((m) => [m.id, m]));
  const seller = byId.get(loot.sellerMemberId);
  if (!seller) return null;

  const owed = loot.payouts.map((payout) => ({ payout, member: byId.get(payout.memberId) }));
  if (owed.some((o) => !o.member)) return null;

  const split = splitDrop({
    amount: loot.saleAmount,
    amountIs,
    sellerFee: memberFee(),
    memberFees: owed.map(() => memberFee()),
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
  /** Sold, everybody paid, nothing left to do. */
  settled: number;
};

/**
 * What a pool is up to: what is unsold, what is sold but not settled, and what is done.
 *
 * The third is not busywork. Counting only the first two meant a pool where everything had been
 * paid reported nothing at all, and a party with a season of drops behind it read exactly like one
 * that had never dropped a thing.
 */
export function summarize(loot: Loot[]): LootSummary {
  return {
    pending: loot.filter((l) => l.status === "PENDING").length,
    awaitingPayout: loot.filter((l) => l.status === "SOLD").length,
    settled: loot.filter((l) => l.status === "PAID_OUT").length,
  };
}

/** The three counts a party row reads its badge off. Mirrors PartyResponse's own fields. */
export type PoolCounts = {
  pendingLoot: number;
  awaitingPayout: number;
  settledLoot: number;
};

/**
 * What a party row says about its pool, or null when there is no pool.
 *
 * Outstanding work wins the line: "2 in the pool" and "1 awaiting payout" are things to go and do,
 * and a settled count beside them would just be noise. Only when there is nothing to do does the
 * settled count get the line, quietly, and that case is the whole point. Showing only the first two
 * meant paying the last share erased every trace of the pool from the list, so a party with a
 * season of drops behind it looked identical to one that had never dropped anything.
 */
export function poolLabel(counts: PoolCounts): { text: string; done: boolean } | null {
  const outstanding = [
    counts.pendingLoot > 0 ? `${counts.pendingLoot} in the pool` : null,
    counts.awaitingPayout > 0 ? `${counts.awaitingPayout} awaiting payout` : null,
  ].filter(Boolean);

  if (outstanding.length > 0) return { text: outstanding.join(" \u00b7 "), done: false };
  if (counts.settledLoot > 0) return { text: `${counts.settledLoot} settled`, done: true };
  return null;
}

/** Every drop the pool holds, whatever state it is in. */
export function poolSize(counts: PoolCounts): number {
  return counts.pendingLoot + counts.awaitingPayout + counts.settledLoot;
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
