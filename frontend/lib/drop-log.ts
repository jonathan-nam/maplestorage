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
// So the total is WHAT THERE WAS TO SPLIT (Split.sellerReceives). That one is defined for all
// three bases: a listed price less the seller's fee, a received figure as entered, or the price a
// party member bought it for, which no fee came off. It is the only cross-basis sum that means one
// thing.

import { formatWeekStart } from "./boss-clears";
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
  /** The catalog drop, when it is one. What consolidate() groups on. Null for free text. */
  dropKey: string | null;
  iconUrl: string | null;
  /** How many pieces the row holds. 1 for a drop that is one item. */
  quantity: number;
  bossKey: string | null;
  droppedOn: string;
  /** The reset week it fell in, as that week's Thursday. The server's reckoning, never redone here. */
  weekStart: string;
  /** ALWAYS / HEROIC when everyone gets their own copy, so the sale is one person's, not a pool's. */
  perMember: string | null;
  status: string;
  saleAmount: number | null;
  amountBasis: string | null;
  splitMethod: string | null;
  /** Who sold it, or who bought it on a BOUGHT basis. Null while it is still in the pool. */
  sellerName: string | null;
  /**
   * What there was to split: what landed in the seller's inventory, fee already off, or the price
   * a member bought it for. Null when unsold, or when the split cannot be read.
   */
  pooled: number | null;
  /** Your side of it: what you kept selling it, plus anything owed to a character of yours. */
  yourTake: number | null;
  /** True when it sold but the split names a seat that has left, so no figure can be shown. */
  unreadable: boolean;
};

/** How the log is broken up. A view choice: the totals above it are the same either way. */
export type Grouping = "month" | "week";

export type DropGroup = {
  /** YYYY-MM for a month, the week's Thursday for a week. Both sort lexically. */
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
  /** Newest first. Grouping is applied at draw time, by groupDrops. */
  entries: DropEntry[];
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

/**
 * "2026-07-16" -> "Week of July 16, 2026".
 *
 * The stem is the week picker's, so a week is worded the same wherever it is named. The year is
 * carried, which the picker does not need: it shows one week, while a log shows every week there
 * has been, and two Julys a year apart would otherwise head two sections identically.
 */
export function weekLabel(weekStart: string): string {
  const year = Number(weekStart.slice(0, 4));
  if (!year) return weekStart;
  return `Week of ${formatWeekStart(weekStart)}, ${year}`;
}

/**
 * Your side of a sale: what you kept if you sold it (or your share of it if you bought it off the
 * party), plus anything owed to a character of yours.
 */
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
 * The whole history, newest first. Cut into sections by groupDrops.
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
        dropKey: loot.dropKey,
        iconUrl: loot.iconUrl,
        quantity: loot.quantity,
        bossKey: loot.bossKey,
        droppedOn: loot.droppedOn,
        weekStart: loot.weekStart,
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

  return { entries, totals: totalsOf(entries) };
}

/** The counts and the money, read off the entries in hand. Never scaled from a wider set. */
function totalsOf(entries: DropEntry[]): DropLogTotals {
  return {
    drops: entries.length,
    sold: entries.filter((e) => e.status !== "PENDING").length,
    pending: entries.filter((e) => e.status === "PENDING").length,
    pooled: entries.reduce((sum, e) => sum + (e.pooled ?? 0), 0),
    yourTake: entries.reduce((sum, e) => sum + (e.yourTake ?? 0), 0),
    unreadable: entries.filter((e) => e.unreadable).length,
  };
}

/** The log narrowed to one character, or all of it. Totals are recomputed, never scaled. */
export function forCharacter(log: DropLog, characterId: string | null): DropLog {
  if (characterId === null) return log;
  const entries = log.entries.filter((e) => e.characterId === characterId);
  return { entries, totals: totalsOf(entries) };
}

/**
 * The log cut into sections, newest first, each subtotalled.
 *
 * Grouping happens here rather than in buildDropLog because it is a view choice: switching between
 * months and weeks re-heads the same entries, and no total above can move.
 *
 * A week is the reset week the drop fell in, straight off the row. The Thursday boundary is the
 * server's (BossPeriod.kt) and is not recomputed here, so the weeks this heads are the weeks the
 * clears matrix steps through.
 */
export function groupDrops(entries: DropEntry[], grouping: Grouping): DropGroup[] {
  const groups = new Map<string, DropGroup>();
  for (const entry of entries) {
    const key = grouping === "week" ? entry.weekStart : entry.droppedOn.slice(0, 7);
    let group = groups.get(key);
    if (!group) {
      const label = grouping === "week" ? weekLabel(key) : monthLabel(entry.droppedOn);
      group = { key, label, entries: [], pooled: 0, yourTake: 0 };
      groups.set(key, group);
    }
    group.entries.push(entry);
    group.pooled += entry.pooled ?? 0;
    group.yourTake += entry.yourTake ?? 0;
  }
  // Insertion order: the entries are newest first, and a group's dates are contiguous, so the
  // sections come out newest first without a second sort.
  return [...groups.values()];
}

/**
 * One line of the log: an ordinary drop, or every row of one stacking drop folded together.
 *
 * A boss that guarantees coupons files a row per boss, so a week of bossing is the same drop listed
 * five times and the only number anybody wants is the total. Folded here rather than in the page,
 * because the count is the point and a component adding it up would be a second answer to it.
 */
export type DropLine = {
  /** The drop key when this is a fold, the loot id when it stands for one row. */
  key: string;
  name: string;
  iconUrl: string | null;
  /** Pieces across every row behind this line. */
  quantity: number;
  /** The rows themselves, newest first. Exactly one unless this is a fold. */
  entries: DropEntry[];
  /** True when it stands for more than one row, so the line says how many bosses. */
  folded: boolean;
  /** Summed the way the group subtotals are, and null when there is nothing sold to sum. */
  pooled: number | null;
  yourTake: number | null;
};

/**
 * The log's rows as lines, folding a catalog drop that appears more than once.
 *
 * Only a CATALOG drop folds: free text is whatever somebody typed, and two rows reading "some cape"
 * are not evidence of one drop. Order is kept from the entries, so the fold sits where its newest
 * row was and the log stays newest-first.
 *
 * The money is summed exactly as a group subtotal is, over `sellerReceives`, which is the one figure
 * that means the same thing on all three bases. See the note at the top of this file.
 */
export function consolidate(entries: DropEntry[]): DropLine[] {
  const byDrop = new Map<string, DropEntry[]>();
  for (const entry of entries) {
    if (entry.dropKey === null) continue;
    const seen = byDrop.get(entry.dropKey);
    if (seen) seen.push(entry);
    else byDrop.set(entry.dropKey, [entry]);
  }

  const lines: DropLine[] = [];
  const done = new Set<string>();
  for (const entry of entries) {
    const rows = entry.dropKey === null ? null : byDrop.get(entry.dropKey);
    if (rows === null || rows === undefined || rows.length === 1) {
      lines.push(lineOf(entry.lootId, [entry], false));
      continue;
    }
    if (done.has(entry.dropKey!)) continue;
    done.add(entry.dropKey!);
    lines.push(lineOf(entry.dropKey!, rows, true));
  }
  return lines;
}

function lineOf(key: string, entries: DropEntry[], folded: boolean): DropLine {
  const sold = entries.filter((e) => e.pooled !== null);
  const first = entries[0]!;
  return {
    key,
    name: first.name,
    iconUrl: first.iconUrl,
    quantity: entries.reduce((sum, e) => sum + e.quantity, 0),
    entries,
    folded,
    pooled: sold.length === 0 ? null : sold.reduce((sum, e) => sum + (e.pooled ?? 0), 0),
    yourTake: sold.length === 0 ? null : sold.reduce((sum, e) => sum + (e.yourTake ?? 0), 0),
  };
}
