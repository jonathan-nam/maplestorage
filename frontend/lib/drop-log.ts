// Every drop your parties have logged, as a history with money attached.
//
// NOT a second splitter. Every meso here is splitOf()'s, which is splitDrop()'s, exactly as
// lib/wallet.ts is. This file decides which drops belong in the history and which side of each
// sale is yours.
//
// THE TOTAL THAT IS NOT HERE: the sum of the sale amounts as entered. A drop entered as "listed
// for 10b" and one entered as "received 9.5b" are DIFFERENT QUANTITIES, one before the Auction
// House cut and one after. Adding them produces a confident, plausible, wrong number, which is the
// failure this repo exists to prevent. And the gross cannot be recovered from a received figure:
// drop-split.ts refuses to infer it, because that would put a number on screen the tool was told
// rather than shown.
//
// So the total is what LANDED IN INVENTORIES (Split.sellerReceives). That one is defined for both
// bases: a listed price less the seller's fee, or the received figure as entered. It is the only
// cross-basis sum that means one thing.

import { splitOf } from "./loot";
import type { Loot, PartyLootPool } from "@/types/loot";
import type { Party, PartyMember } from "@/types/party";

/** A seat is yours when it links to your roster. Same test the wallet uses. */
function isMine(member: PartyMember): boolean {
  return member.characterId !== null;
}

export type DropEntry = {
  lootId: string;
  partyId: string;
  /** Whose config it dropped on, so the log can be read one character at a time. */
  characterId: string;
  name: string;
  iconUrl: string | null;
  bossKey: string | null;
  droppedOn: string;
  /** ALWAYS / HEROIC when everyone gets their own copy, so the sale is one person's, not a pool's. */
  perMember: string | null;
  status: string;
  saleAmount: number | null;
  amountBasis: string | null;
  splitMethod: string | null;
  /** Who sold it. Null while it is still in the pool. */
  sellerName: string | null;
  /**
   * What landed in the seller's inventory, fee already off. Null when unsold, or when the split
   * cannot be read.
   */
  pooled: number | null;
  /** Your side of it: what you kept selling it, plus anything owed to a character of yours. */
  yourTake: number | null;
  /** True when it sold but the split names a seat that has left, so no figure can be shown. */
  unreadable: boolean;
};

export type DropMonth = {
  /** YYYY-MM, which sorts lexically. */
  key: string;
  label: string;
  entries: DropEntry[];
  pooled: number;
  yourTake: number;
};

export type DropLogTotals = {
  drops: number;
  sold: number;
  pending: number;
  /** Across sold drops: what landed in inventories, party-wide. See the header note. */
  pooled: number;
  /** Across sold drops: your side of them. */
  yourTake: number;
  /** Sold drops whose split cannot be read. Their money is in neither total above. */
  unreadable: number;
};

export type DropLog = {
  months: DropMonth[];
  totals: DropLogTotals;
};

const MONTHS =
  "January February March April May June July August September October November December".split(
    " ",
  );

/**
 * "2026-07-20" -> "July 2026", without going through Date.
 *
 * new Date("2026-07-20") is UTC midnight, so anyone behind UTC reads the month before on the 1st.
 * Same reasoning as formatDropped in lib/loot.ts.
 */
export function monthLabel(iso: string): string {
  const [year, month] = iso.split("-").map(Number);
  if (!year || !month) return iso;
  return `${MONTHS[month - 1] ?? month} ${year}`;
}

/** Your side of a sale: what you kept if you sold it, plus anything owed to a character of yours. */
function takeFor(loot: Loot, members: PartyMember[]): number | null {
  const split = splitOf(loot, members);
  if (split === null) return null;

  const byId = new Map(members.map((m) => [m.id, m]));
  const seller = byId.get(split.seller.memberId);
  // Both halves are counted, not one or the other: bringing two of your own characters means you
  // sold it AND are owed a share of it, and taking only the larger would under-count.
  const kept = seller && isMine(seller) ? split.seller.keeps : 0;
  const owed = split.shares
    .filter((share) => {
      const member = byId.get(share.memberId);
      return member ? isMine(member) : false;
    })
    .reduce((sum, share) => sum + share.nets, 0);
  return kept + owed;
}

/**
 * The whole history, newest month first.
 *
 * Every logged drop is here, sold or not: "what have we got off Limbo this year" is as much the
 * question as "what did it make".
 */
export function buildDropLog(parties: Party[], pools: PartyLootPool[]): DropLog {
  const partyById = new Map(parties.map((p) => [p.id, p]));
  const entries: DropEntry[] = [];

  for (const pool of pools) {
    const party = partyById.get(pool.partyId);
    if (!party) continue;

    for (const loot of pool.loot) {
      const sold = loot.soldAt !== null;
      const split = sold ? splitOf(loot, party.seats) : null;
      const unreadable = sold && split === null;

      entries.push({
        lootId: loot.id,
        partyId: pool.partyId,
        characterId: party.characterId,
        name: loot.name,
        iconUrl: loot.iconUrl,
        bossKey: loot.bossKey,
        droppedOn: loot.droppedOn,
        perMember: loot.perMember,
        status: loot.status,
        saleAmount: loot.saleAmount,
        amountBasis: loot.amountBasis,
        splitMethod: loot.splitMethod,
        sellerName: split?.seller.name ?? null,
        pooled: split?.split.sellerReceives ?? null,
        yourTake: split ? takeFor(loot, party.seats) : null,
        unreadable,
      });
    }
  }

  // Newest first, and stable on the id so two drops logged the same day keep one order.
  entries.sort(
    (a, b) => b.droppedOn.localeCompare(a.droppedOn) || a.lootId.localeCompare(b.lootId),
  );

  const months = new Map<string, DropMonth>();
  for (const entry of entries) {
    const key = entry.droppedOn.slice(0, 7);
    let month = months.get(key);
    if (!month) {
      month = { key, label: monthLabel(entry.droppedOn), entries: [], pooled: 0, yourTake: 0 };
      months.set(key, month);
    }
    month.entries.push(entry);
    month.pooled += entry.pooled ?? 0;
    month.yourTake += entry.yourTake ?? 0;
  }

  const totals: DropLogTotals = {
    drops: entries.length,
    sold: entries.filter((e) => e.status !== "PENDING").length,
    pending: entries.filter((e) => e.status === "PENDING").length,
    pooled: entries.reduce((sum, e) => sum + (e.pooled ?? 0), 0),
    yourTake: entries.reduce((sum, e) => sum + (e.yourTake ?? 0), 0),
    unreadable: entries.filter((e) => e.unreadable).length,
  };

  return { months: [...months.values()], totals };
}

/** The log narrowed to one character, or all of it. Totals are recomputed, never scaled. */
export function forCharacter(log: DropLog, characterId: string | null): DropLog {
  if (characterId === null) return log;
  const months = log.months
    .map((month) => {
      const entries = month.entries.filter((e) => e.characterId === characterId);
      return {
        ...month,
        entries,
        pooled: entries.reduce((sum, e) => sum + (e.pooled ?? 0), 0),
        yourTake: entries.reduce((sum, e) => sum + (e.yourTake ?? 0), 0),
      };
    })
    .filter((month) => month.entries.length > 0);

  const all = months.flatMap((m) => m.entries);
  return {
    months,
    totals: {
      drops: all.length,
      sold: all.filter((e) => e.status !== "PENDING").length,
      pending: all.filter((e) => e.status === "PENDING").length,
      pooled: all.reduce((sum, e) => sum + (e.pooled ?? 0), 0),
      yourTake: all.reduce((sum, e) => sum + (e.yourTake ?? 0), 0),
      unreadable: all.filter((e) => e.unreadable).length,
    },
  };
}
