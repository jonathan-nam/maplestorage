// The queue of outstanding pieces, built from what the pools endpoint already returns.
//
// The arithmetic is piece-ledger.ts and none of it is repeated here. This file only decides WHICH
// drops are outstanding, whose pile they are in, and what each seat was entitled to, so the one
// input ("sold N pieces for X") can be distributed without anybody naming a boss.
//
// What makes that possible without recording who looted what: the count on the row already says.
// A clear files the WHOLE drop when the party names a looter, because it is all in one inventory,
// and this character's SHARE when everybody loots their own (see LootFromClear.kt). So a row with a
// looter is a debt waiting to be priced, and a row without one is a record and nothing else.
//
// The exception it cannot express is two members each looting some of one drop. That is rare, and
// the alternative was a per-seat table and a box per seat on every row, which is the cumbersome
// thing this replaces.

import { type LedgerDrop, type PieceSale, allocate, transfersOf } from "./piece-ledger";
import type { PieceTransfer } from "./piece-ledger";
import type { Loot, PartyLootPool } from "@/types/loot";
import type { Party } from "@/types/party";

/** One boss's outstanding pieces, ready for the queue, with who is holding them. */
export type OutstandingDrop = {
  drop: LedgerDrop;
  lootId: string;
  partyId: string;
  bossKey: string | null;
  /** The character holding the pieces. The tranche tally is theirs, so the queue is split by it. */
  looterName: string;
};

/** One looter's pile: their queue, and what each boss in it owes once its pieces are covered. */
export type LooterLedger = {
  looterName: string;
  /** Pieces they are holding across every outstanding boss. */
  pieces: number;
  drops: {
    lootId: string;
    partyId: string;
    bossKey: string | null;
    weekStart: string;
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
 * Every drop that still owes somebody, oldest first.
 *
 * A drop is outstanding when its party names a looter: that seat holds the lot and owes the others
 * their share. A drop on a party where everybody loots their own owes nothing and is left out
 * entirely, which is why an even night never appears here and asks nothing of anybody.
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

    for (const loot of pool.loot) {
      if (loot.dropKey !== dropKey || loot.quantity < 1) continue;
      out.push({
        lootId: loot.id,
        partyId: pool.partyId,
        bossKey: loot.bossKey,
        looterName: looter.name,
        drop: {
          id: loot.id,
          weekStart: loot.weekStart,
          order: bossOrder.get(loot.bossKey ?? "") ?? Number.MAX_SAFE_INTEGER,
          total: loot.quantity,
          // The looter holds all of it; everybody else who ran holds none and is owed their share.
          seats: ran.map((seat) => ({
            memberId: seat.id,
            name: seat.name,
            looted: seat.id === looter.id ? loot.quantity : 0,
            shares: 1,
          })),
        },
      });
    }
  }
  return out;
}

/**
 * One card per looter: their pile, their queue, and what each boss owes.
 *
 * Sales are per looter because the pieces are in that character's inventory and cannot be moved out
 * of it. Yours are the ones you sold; a partner's are what they told you they got.
 *
 * Drops with nothing owed are dropped here rather than listed with an empty debt list, so the card
 * only ever shows work.
 */
export function looterLedgers(
  drops: OutstandingDrop[],
  salesByLooter: Map<string, PieceSale[]>,
): LooterLedger[] {
  const byLooter = new Map<string, OutstandingDrop[]>();
  for (const d of drops) {
    const seen = byLooter.get(d.looterName);
    if (seen) seen.push(d);
    else byLooter.set(d.looterName, [d]);
  }

  const ledgers: LooterLedger[] = [];
  for (const [looterName, mine] of byLooter) {
    const coverage = allocate(
      mine.map((d) => d.drop),
      salesByLooter.get(looterName) ?? [],
    );
    // The queue's own order, so the card reads the way the pieces are being spent.
    const ordered = [...mine].sort(
      (a, b) =>
        a.drop.weekStart.localeCompare(b.drop.weekStart) ||
        a.drop.order - b.drop.order ||
        a.drop.id.localeCompare(b.drop.id),
    );
    ledgers.push({
      looterName,
      pieces: mine.reduce((sum, d) => sum + d.drop.total, 0),
      drops: ordered
        .map((d) => {
          const cover = coverage.get(d.drop.id);
          return {
            lootId: d.lootId,
            partyId: d.partyId,
            bossKey: d.bossKey,
            weekStart: d.drop.weekStart,
            pieces: d.drop.total,
            covered: cover?.covered ?? 0,
            complete: cover?.complete ?? false,
            averagePrice: cover?.averagePrice ?? null,
            transfers: transfersOf(d.drop, cover),
          };
        })
        .filter((d) => d.transfers.length > 0),
    });
  }
  return ledgers.sort((a, b) => a.looterName.localeCompare(b.looterName));
}

/** The sales one looter has entered, keyed the way looterLedgers wants them. */
export function salesByLooter(
  rows: { looterName: string; pieces: number; amount: number }[],
): Map<string, PieceSale[]> {
  const out = new Map<string, PieceSale[]>();
  for (const row of rows) {
    // The tally stores a TOTAL, because that is what a partner reports ("1.2b for the 60"). The
    // per-piece figure the split needs is derived, never typed.
    const sale: PieceSale = { pieces: row.pieces, priceEach: row.amount / row.pieces };
    const seen = out.get(row.looterName);
    if (seen) seen.push(sale);
    else out.set(row.looterName, [sale]);
  }
  return out;
}

/** Pieces still to sell across a looter's whole pile. What the card's header counts down. */
export function unsold(ledger: LooterLedger): number {
  return ledger.drops.reduce((sum, d) => sum + (d.pieces - d.covered), 0);
}

/** Every drop that mentions this loot row, for the row's own read-only display. */
export function ledgerForLoot(
  ledgers: LooterLedger[],
  lootId: string,
): { looterName: string; drop: LooterLedger["drops"][number] } | null {
  for (const ledger of ledgers) {
    const drop = ledger.drops.find((d) => d.lootId === lootId);
    if (drop) return { looterName: ledger.looterName, drop };
  }
  return null;
}
