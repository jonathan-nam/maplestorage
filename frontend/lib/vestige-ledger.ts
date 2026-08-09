// The queue of outstanding pieces, built from what the pools endpoint already returns.
//
// The arithmetic is piece-ledger.ts and none of it is repeated here. This file only decides WHICH
// drops are outstanding, whose pile they are in, and what each HOLDER was entitled to, so the one
// input ("sold N pieces for X") can be distributed without anybody naming a boss.
//
// What makes that possible without recording who looted what: the party already says. A row's
// quantity is WHAT FELL (see V40), and the config says whether one seat picked it all up. So a row
// on a party that names a looter is a debt waiting to be priced, and a row on one where everybody
// loots their own is a record and nothing else.
//
// The exception it cannot express is two members each looting some of one drop. That is rare, and
// the alternative was a per-seat table and a box per seat on every row, which is the cumbersome
// thing this replaces.
//
// A HOLDER is a person, not a character. Seats are folded to their holder before anything is
// counted, which is what makes a party of your own two characters owe nothing at all: you cannot
// owe yourself. It is also why one person running three characters has one pile and one box, rather
// than three of each saying the same human owes you three times.

import {
  type LedgerDrop,
  type PieceSale,
  allocate,
  entitlements,
  transfersOf,
} from "./piece-ledger";
import type { PieceTransfer } from "./piece-ledger";
import type { PartyLootPool } from "@/types/loot";
import type { Party, PartyMember } from "@/types/party";

/** Whose pile it is. Mirrors the three kinds V39 stores, and is what a tranche is filed under. */
export type Holder = {
  kind: "PERSON" | "SELF" | "CHARACTER";
  personId: string | null;
  /** Lowercased. Only a CHARACTER holder has one: nobody has said who plays them yet. */
  characterName: string | null;
};

/** One boss's outstanding pieces, ready for the queue, with who is holding them. */
export type OutstandingDrop = {
  drop: LedgerDrop;
  lootId: string;
  partyId: string;
  bossKey: string | null;
  /** Whose pile the pieces are in. The tranche tally is theirs, so the queue is split by it. */
  holder: Holder;
  /** What to call them on screen. */
  holderName: string;
  /** The character that actually looted it. Shown on the row, never what anything is keyed by. */
  looterName: string;
};

/** One holder's pile: their queue, and what each boss in it owes once its pieces are covered. */
export type HolderLedger = {
  holder: Holder;
  holderName: string;
  /** Pieces they are holding across every outstanding boss. */
  pieces: number;
  /**
   * Of those, how many are YOURS, and what the sold ones have made you.
   *
   * The figure to lead with on somebody else's card: what they are holding is their business, and
   * what you are owed out of it is the reason the card exists. Zero on your own card, where the
   * debts run the other way.
   */
  owedToYou: number;
  /** Mesos they owe you NOW, for the pieces of yours that have already sold. Pro rata. */
  dueNow: number;
  drops: {
    lootId: string;
    partyId: string;
    bossKey: string | null;
    weekStart: string;
    /** Which of this holder's characters looted it. */
    looterName: string;
    pieces: number;
    covered: number;
    /** Its pieces have all sold, so its debts are final. */
    complete: boolean;
    /** What one piece of THIS boss fetched, or null until it is covered. */
    averagePrice: number | null;
    transfers: PieceTransfer[];
  }[];
};

/**
 * Who a seat belongs to.
 *
 * Your own characters are not on the people list at all, so they are not "unattributed": they are
 * you, which is what `characterId` says. Getting that wrong is the difference between a party of
 * your two characters owing nothing and it owing you half of what you already have.
 */
export function holderOf(seat: PartyMember): Holder {
  if (seat.personId !== null)
    return { kind: "PERSON", personId: seat.personId, characterName: null };
  if (seat.characterId !== null) return { kind: "SELF", personId: null, characterName: null };
  return { kind: "CHARACTER", personId: null, characterName: seat.name.trim().toLowerCase() };
}

/** You, as a holder key. The one seat on any drop whose side of a debt is your own. */
export const SELF_KEY = "self";

/** How a holder is matched, on either side of the wire. One pile, one key, however it is spelled. */
export function holderKey(holder: Holder): string {
  if (holder.kind === "PERSON") return `person:${holder.personId}`;
  if (holder.kind === "SELF") return SELF_KEY;
  return `character:${holder.characterName}`;
}

/** What to call a holder. Yours are "you", because that is who they are on your own screen. */
export function holderName(seat: PartyMember): string {
  if (seat.personId !== null) return seat.personName ?? seat.name;
  if (seat.characterId !== null) return "you";
  return seat.name;
}

/** One holder in a party: who they are, and how many shares their seats add up to. */
export type FoldedSeat = { key: string; holder: Holder; name: string; shares: number };

/**
 * A party's seats folded to the people behind them.
 *
 * The one place seats become people, so a debt, a share and a count are all measured against the
 * same list. Two characters of one person are one holder with two shares: they are owed twice as
 * much as somebody who brought one, and they are owed it once.
 */
export function foldSeats(seats: PartyMember[]): FoldedSeat[] {
  const folded = new Map<string, FoldedSeat>();
  for (const seat of seats) {
    const holder = holderOf(seat);
    const key = holderKey(holder);
    const seen = folded.get(key);
    if (seen) seen.shares += seat.shares;
    else folded.set(key, { key, holder, name: holderName(seat), shares: seat.shares });
  }
  return [...folded.values()];
}

/**
 * How many of a piece drop are YOURS, out of what fell.
 *
 * Derived on every read and stored nowhere. The inputs (who ran, how the shares fall) are edited
 * long after a drop is filed, and a stored share does not follow them: that is what had one Limbo
 * row reading 60 for a character who got 20. See V40.
 *
 * Zero when none of the seats are yours, which is a party you keep the books for but did not run.
 */
export function yourShare(whole: number, seats: PartyMember[]): number {
  const folded = foldSeats(seats);
  const entitled = entitlements(
    whole,
    folded.map((f) => ({ memberId: f.key, name: f.name, looted: 0, shares: f.shares })),
  );
  return entitled.get(SELF_KEY) ?? 0;
}

/**
 * Every drop that still owes somebody, oldest first.
 *
 * A drop is outstanding when its party names a looter: that seat holds the lot and owes the others
 * their share. A drop on a party where everybody loots their own owes nothing and is left out
 * entirely, which is why an even night never appears here and asks nothing of anybody.
 *
 * Left out for the same reason: a party whose seats are all ONE person, however many characters
 * they brought. Nobody owes anybody, and the pieces are already where they belong.
 *
 * `bossOrder` breaks ties inside a week, and should be the catalog's own order so the queue never
 * depends on which row was read first. A boss missing from it sorts last rather than throwing.
 */
export function outstanding(
  parties: Party[],
  pools: PartyLootPool[],
  dropKey: string,
  bossOrder: Map<string, number>,
): OutstandingDrop[] {
  const partyById = new Map(parties.map((p) => [p.id, p]));
  const out: OutstandingDrop[] = [];

  for (const pool of pools) {
    const party = partyById.get(pool.partyId);
    if (!party || party.looterMemberId === null) continue;
    const looter = party.seats.find((s) => s.id === party.looterMemberId);
    if (!looter) continue;

    // Who ran that week is who the shares are measured against, the same list a payout uses.
    const ran = party.members;
    if (ran.length < 2) continue;

    // Seats folded to holders: two characters of one person are one share of the drop and one
    // party to the debt. A night that folds to a single holder is nobody owing anybody.
    const holders = foldSeats(ran);
    if (holders.length < 2) continue;

    const looterHolder = holderKey(holderOf(looter));

    for (const loot of pool.loot) {
      if (loot.dropKey !== dropKey || loot.quantity < 1) continue;
      out.push({
        lootId: loot.id,
        partyId: pool.partyId,
        bossKey: loot.bossKey,
        holder: holderOf(looter),
        holderName: holderName(looter),
        looterName: looter.name,
        drop: {
          id: loot.id,
          weekStart: loot.weekStart,
          order: bossOrder.get(loot.bossKey ?? "") ?? Number.MAX_SAFE_INTEGER,
          total: loot.quantity,
          // The looter's holder has all of it; every other holder has none and is owed their share.
          seats: holders.map((h) => ({
            memberId: h.key,
            name: h.name,
            looted: h.key === looterHolder ? loot.quantity : 0,
            shares: h.shares,
          })),
        },
      });
    }
  }
  return out;
}

/**
 * One card per holder: their pile, their queue, and what each boss owes.
 *
 * Sales are per holder because that is who sold them. One person's characters share a queue: the
 * coupons cannot move between their inventories, but mesos are fungible and what the ledger settles
 * is what that human owes. Which character looted a boss is carried on the row for that reason.
 */
export function holderLedgers(
  drops: OutstandingDrop[],
  salesByHolder: Map<string, PieceSale[]>,
): HolderLedger[] {
  const byHolder = new Map<string, OutstandingDrop[]>();
  for (const d of drops) {
    const seen = byHolder.get(holderKey(d.holder));
    if (seen) seen.push(d);
    else byHolder.set(holderKey(d.holder), [d]);
  }

  const ledgers: HolderLedger[] = [];
  for (const [key, mine] of byHolder) {
    const coverage = allocate(
      mine.map((d) => d.drop),
      salesByHolder.get(key) ?? [],
    );
    // The queue's own order, so the card reads the way the pieces are being spent.
    const ordered = [...mine].sort(
      (a, b) =>
        a.drop.weekStart.localeCompare(b.drop.weekStart) ||
        a.drop.order - b.drop.order ||
        a.drop.id.localeCompare(b.drop.id),
    );
    // Every outstanding drop, including any that owes nothing, because its pieces are in this pile
    // and the tranches are spent across all of it. Listing only some would leave the header
    // counting pieces the rows below it do not account for.
    const drops = ordered.map((d) => {
      const cover = coverage.get(d.drop.id);
      return {
        lootId: d.lootId,
        partyId: d.partyId,
        bossKey: d.bossKey,
        weekStart: d.drop.weekStart,
        looterName: d.looterName,
        pieces: d.drop.total,
        covered: cover?.covered ?? 0,
        complete: cover?.complete ?? false,
        averagePrice: cover?.averagePrice ?? null,
        transfers: transfersOf(d.drop, cover),
      };
    });
    // Your side of this pile, read off the transfers rather than recomputed: whatever they are
    // told to send you is what you are owed, and two sums of that would be two answers.
    const yours = drops.flatMap((d) => d.transfers).filter((t) => t.toId === SELF_KEY);

    ledgers.push({
      holder: mine[0]!.holder,
      holderName: mine[0]!.holderName,
      pieces: mine.reduce((sum, d) => sum + d.drop.total, 0),
      owedToYou: yours.reduce((sum, t) => sum + t.pieces, 0),
      dueNow: yours.reduce((sum, t) => sum + (t.send ?? 0), 0),
      drops,
    });
  }
  return ledgers.sort((a, b) => a.holderName.localeCompare(b.holderName));
}

/** The sales one holder has entered, keyed the way holderLedgers wants them. */
export function salesByHolder(
  rows: { holder: Holder; pieces: number; amount: number }[],
): Map<string, PieceSale[]> {
  const out = new Map<string, PieceSale[]>();
  for (const row of rows) {
    // The tally stores a TOTAL, because that is what a partner reports ("1.2b for the 60"). The
    // per-piece figure the split needs is derived, never typed.
    const sale: PieceSale = { pieces: row.pieces, priceEach: row.amount / row.pieces };
    const key = holderKey(row.holder);
    const seen = out.get(key);
    if (seen) seen.push(sale);
    else out.set(key, [sale]);
  }
  return out;
}

/** Pieces still to sell across a holder's whole pile. What the card's header counts down. */
export function unsold(ledger: HolderLedger): number {
  return ledger.drops.reduce((sum, d) => sum + (d.pieces - d.covered), 0);
}

/** Every drop that mentions this loot row, for the row's own read-only display. */
export function ledgerForLoot(
  ledgers: HolderLedger[],
  lootId: string,
): { holderName: string; drop: HolderLedger["drops"][number] } | null {
  for (const ledger of ledgers) {
    const drop = ledger.drops.find((d) => d.lootId === lootId);
    if (drop) return { holderName: ledger.holderName, drop };
  }
  return null;
}
