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
import { splitOf, statusLabel } from "./loot";
import { holderKey, holderOf, yourShare } from "./vestige-ledger";
import type { DropTables } from "@/types/drop";
import type { Loot, PartyLootPool } from "@/types/loot";
import type { Party, PartyMember } from "@/types/party";

/** A seat is yours when it links to your roster. Same test the wallet uses. */
function isMine(member: PartyMember): boolean {
  return member.characterId !== null;
}

/**
 * True when this row is a stack of pieces the party divides by COUNT.
 *
 * Read off the catalog's own table for the boss and the mode the party runs, which is the one place
 * that knows: vestige coupons divide, a ring does not, and the row itself cannot tell you which it
 * is holding. A boss with no amount for its difficulty is not a piece drop, so its count is left
 * exactly as it was entered.
 */
export function isPieceDrop(loot: Loot, party: Party, dropTables: DropTables): boolean {
  if (loot.dropKey === null || party.difficulty === null) return false;
  const table = dropTables[loot.bossKey ?? ""] ?? [];
  return (table.find((d) => d.dropKey === loot.dropKey)?.pieces?.[party.difficulty] ?? 0) > 0;
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
  /** What FELL, as V40 files it. Not your share of it, which is `yours`. */
  quantity: number;
  /**
   * This row is a stack of pieces the party divides by COUNT, not a thing that sells as money.
   *
   * It changes what "in the pool" means. A piece drop is settled through the tranche ledger and
   * never through a sale on this row, so its `sold_at` stays null for ever: counting it as pending
   * put every coupon drop the account has ever had into the pool, permanently.
   */
  pieces: boolean;
  /**
   * How many of it are YOURS: your share of a piece drop, or the whole count of anything else.
   *
   * Worked out from the party as it stands, never stored. What the log counts and what a row
   * shows, because "how many did I get" is the question a log of your own drops answers.
   */
  yours: number;
  /** The character holding your share until they hand it over, when one seat looted the lot. */
  owedBy: string | null;
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
  /**
   * Drops with something still to do, which is NOT the same as drops not yet sold.
   *
   * A piece drop you already hold your share of is a record, not work: the coupons are in your
   * inventory, you sell them yourself, and the row will never be marked sold because that is not
   * how pieces settle. Counting those put every coupon drop the account has ever had in the pool,
   * for ever, on parties where the split came out exactly even.
   */
  pending: number;
  /** Coupons somebody ELSE is holding for you. The pieces behind the count above. */
  piecesOwed: number;
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
export function buildDropLog(
  parties: Party[],
  pools: PartyLootPool[],
  /** The catalog's drop tables. What says a row is a stack of pieces rather than one item. */
  dropTables: DropTables,
): DropLog {
  const partyById = new Map(parties.map((p) => [p.id, p]));
  const entries: DropEntry[] = [];

  for (const pool of pools) {
    const party = partyById.get(pool.partyId);
    if (!party) continue;

    for (const loot of pool.loot) {
      const sold = loot.soldAt !== null;
      const split = sold ? splitOf(loot, party.seats) : null;
      const unreadable = sold && split === null;

      // Only a PIECE drop divides by count. Everything else is one thing that sells for one price
      // and divides as money, and a third of an item is not a number to put on a row.
      const pieces = isPieceDrop(loot, party, dropTables);
      const looter = party.seats.find((s) => s.id === party.looterMemberId) ?? null;

      entries.push({
        lootId: loot.id,
        partyId: pool.partyId,
        characterId: party.characterId,
        name: loot.name,
        dropKey: loot.dropKey,
        iconUrl: loot.iconUrl,
        quantity: loot.quantity,
        pieces,
        yours: pieces ? yourShare(loot.quantity, party.members) : loot.quantity,
        // Named only when somebody ELSE is holding it. Your own seat looting the lot is not a debt
        // to you, it is you having it already.
        owedBy:
          pieces && looter !== null && holderKey(holderOf(looter)) !== "self" ? looter.name : null,
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

/**
 * Work still to do on a drop.
 *
 * A piece drop is settled through the tranche ledger, never through a sale on its own row, so
 * "not sold" says nothing about it. What is left to do is whether somebody else is holding your
 * share: `owedBy` is set only then, and a party that divided evenly leaves it null.
 */
export function isOutstanding(entry: DropEntry): boolean {
  // Unsold either way. Keying only on `owedBy` counted a piece drop that HAD been sold and paid
  // out through the money path, which is the one way a coupon row does reach a settled state.
  if (entry.status !== "PENDING") return false;
  return !entry.pieces || entry.owedBy !== null;
}

/**
 * What a row says its state is.
 *
 * "In the pool" off the raw status was wrong for most coupon drops: the row never sells, so it
 * said that for ever on a night where the coupons went straight into the right inventories. Those
 * are yours already, and the row is a record of getting them.
 */
export function dropStatusLabel(entry: DropEntry): string {
  if (entry.pieces && entry.owedBy === null) return "Yours";
  return statusLabel(entry.status);
}

/** The counts and the money, read off the entries in hand. Never scaled from a wider set. */
function totalsOf(entries: DropEntry[]): DropLogTotals {
  return {
    drops: entries.length,
    sold: entries.filter((e) => e.status !== "PENDING").length,
    pending: entries.filter(isOutstanding).length,
    piecesOwed: entries
      .filter((e) => e.pieces && e.owedBy !== null)
      .reduce((sum, e) => sum + e.yours, 0),
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
  /**
   * How many of it are YOURS, across every row behind this line. What the line shows.
   *
   * Named the same as DropEntry.yours on purpose. This was `quantity` while the entry's `quantity`
   * meant what FELL, and the runs behind a fold were rendered off the wrong one: a line reading 440
   * opened onto runs adding up to 900.
   */
  yours: number;
  /** How many FELL across those rows. Only differs where somebody else took a share. */
  fell: number;
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
 * Inside a fold the runs go by CHARACTER, in `characterOrder`, which is the order the roster is
 * arranged in. Eleven runs newest-first interleaved six characters, so reading one character's
 * night meant picking their rows out of the list. Same argument the party arrangements make, and
 * the same parameter: see consolidate() in lib/parties.ts.
 *
 * The money is summed exactly as a group subtotal is, over `sellerReceives`, which is the one figure
 * that means the same thing on all three bases. See the note at the top of this file.
 */
export function consolidate(entries: DropEntry[], characterOrder: string[]): DropLine[] {
  const byDrop = new Map<string, DropEntry[]>();
  for (const entry of entries) {
    if (entry.dropKey === null) continue;
    const seen = byDrop.get(entry.dropKey);
    if (seen) seen.push(entry);
    else byDrop.set(entry.dropKey, [entry]);
  }

  // A character off the end of the roster sorts last rather than first, which is where a missing
  // index would otherwise put every one of them.
  const rank = new Map(characterOrder.map((id, i) => [id, i]));
  const byCharacter = (a: DropEntry, b: DropEntry) =>
    (rank.get(a.characterId) ?? Number.MAX_SAFE_INTEGER) -
    (rank.get(b.characterId) ?? Number.MAX_SAFE_INTEGER);

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
    // Sorted on a copy: `entries` is the log's own newest-first order and the LINE's place in the
    // list is read off it, so sorting in place would move the fold as well as its runs. A stable
    // sort, so one character's own runs stay newest first inside their group.
    lines.push(lineOf(entry.dropKey!, [...rows].sort(byCharacter), true));
  }
  return lines;
}

/**
 * The distinct names behind a fold, or how many there are once there are too many to read.
 *
 * Names it does not have are left out rather than counted, so the count is only ever of things the
 * line could have named. Eleven coupon rows headed themselves with the first row's character, which
 * is one name standing for six characters' drops.
 */
export function foldNames(
  names: (string | null | undefined)[],
  plural: string,
  max = 3,
): string | null {
  const distinct = [...new Set(names.filter((n): n is string => Boolean(n)))];
  if (distinct.length === 0) return null;
  return distinct.length <= max ? distinct.join(", ") : `${distinct.length} ${plural}`;
}

function lineOf(key: string, entries: DropEntry[], folded: boolean): DropLine {
  const sold = entries.filter((e) => e.pooled !== null);
  const first = entries[0]!;
  return {
    key,
    name: first.name,
    iconUrl: first.iconUrl,
    // Yours, not what fell: a log of your drops that counts somebody else's share is the
    // overcount this replaced. What fell is kept beside it rather than lost.
    yours: entries.reduce((sum, e) => sum + e.yours, 0),
    fell: entries.reduce((sum, e) => sum + e.quantity, 0),
    entries,
    folded,
    pooled: sold.length === 0 ? null : sold.reduce((sum, e) => sum + (e.pooled ?? 0), 0),
    yourTake: sold.length === 0 ? null : sold.reduce((sum, e) => sum + (e.yourTake ?? 0), 0),
  };
}
