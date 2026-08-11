// The queue of outstanding pieces, built from what the pools endpoint already returns.
//
// The arithmetic is piece-ledger.ts and none of it is repeated here. This file only decides WHICH
// drops are outstanding, whose pile they are in, and what each HOLDER was entitled to, so the one
// input ("sold N pieces for X") can be distributed without anybody naming a boss.
//
// A row's quantity is WHAT FELL (see V40). Who ended up holding it comes from three places, and
// this file's job is knowing which one applies, in this order: a recorded arrangement splits it
// stack by stack (V41), a named looter holds the lot, or the stacks divide and everybody took their
// share. The arrangement first because it is what happened, where the looter is only what was agreed.
//
// A fourth case exists and is deliberately NOT answered: the drop did not divide and nobody has
// said who took the odd stack. It used to be called rare and skipped, which was wrong twice over.
// Seven of the eleven vestige rows fall in 3 stacks, so no duo can divide them and it is the
// ordinary night; and skipping it recorded no debt at all rather than an unknown one. It is
// `unanswered()` now, and it names the size of the hole without guessing its direction.
//
// A HOLDER is a person, not a character. Seats are folded to their holder before anything is
// counted, which is what makes a party of your own two characters owe nothing at all: you cannot
// owe yourself. It is also why one person running three characters has one pile and one box, rather
// than three of each saying the same human owes you three times.

import {
  type LedgerDrop,
  type PieceSale,
  allocate,
  balances,
  entitlements,
  heldOf,
  ownShareOf,
  sellableOf,
  spreadBought,
  spreadKept,
  transfersOf,
} from "./piece-ledger";
import type { PieceTransfer } from "./piece-ledger";
import type { Loot, PartyLootPool } from "@/types/loot";
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
  /**
   * Of those, how many their sales have already reached, so that much of the debt cannot move.
   *
   * The figure the card leads with, because it is the one that answers "how far through is this" in
   * the units you are owed. Read off the transfers, like `owedToYou` and `dueNow`, so all three are
   * the same answer counted once.
   */
  settledToYou: number;
  /** Mesos they owe you NOW, for the pieces of yours that have already sold. Pro rata. */
  dueNow: number;
  /**
   * Mesos that have actually arrived. What `dueNow` is measured against. See V51.
   *
   * The fact nothing else can know. Every other figure on this card follows from what happened to the
   * coupons, and a pile whose every piece was sold and priced still owes until this covers it: priced
   * and paid are different, and without the second the bill could never be retired.
   */
  received: number;
  /**
   * Nothing left to enter and nothing left to collect, so the card can stop asking.
   *
   * Every sellable piece accounted for AND the money arrived. Both, because either alone is a pile
   * halfway through: sold but unpaid is a bill, and paid but unsold is somebody who ran ahead.
   */
  settled: boolean;
  /**
   * Pieces of the pile they are redeeming rather than selling, as entered.
   *
   * More than `pieces` is a miscount, and the two are carried side by side so it can be said out loud
   * rather than clamped away: every drop reads as fully kept and the surplus is nowhere.
   */
  kept: number;
  /**
   * Pieces of the pile that are their OWN, which is the most they can redeem.
   *
   * What the kept box is bounded by. Pieces of yours they take anyway are a purchase, priced, rather
   * than a redemption priced off whatever their own sales happened to reach. See V50.
   */
  ownShare: number;
  /** Pieces of yours they bought outright, and what they agreed to pay. See V50. */
  bought: { pieces: number; paid: number };
  /** Pieces entered as sold, whatever the queue has managed to spend them on. */
  soldPieces: number;
  /**
   * Every drop under this holder has had its books closed, so the card is done. See V52.
   *
   * Not derived from the money, and it cannot be: a drop is queued on `entitled - looted`, fixed when
   * it was logged, so nothing about a sale or a payment can retire it. Somebody decides.
   */
  closed: boolean;
  /** Mesos written off across the acts that closed this pile. Said, because a write-off is a decision. */
  writtenOff: number;
  /**
   * Pieces of the pile whose fate has been entered: sold, kept, or taken.
   *
   * What the card counts towards `pieces`, and the nearest thing it has to an instruction: the gap
   * between the two is exactly what it is still waiting to be told. Above `pieces` is a miscount, and
   * carried raw so it can be said rather than clamped.
   */
  accounted: number;
  drops: {
    lootId: string;
    partyId: string;
    bossKey: string | null;
    weekStart: string;
    /** Which of this holder's characters looted it. */
    looterName: string;
    pieces: number;
    /** Of those, how many are being redeemed. Taken off the newest end of the queue. */
    kept: number;
    /** Of those, how many they bought off you, and for what. Off the newest end as well. */
    bought: { pieces: number; paid: number } | null;
    /** Its books are closed, so it is history rather than something the card is waiting on. See V52. */
    closed: boolean;
    /** Pieces of it actually for sale, which is what `covered` counts towards. */
    sellable: number;
    covered: number;
    /** Every sellable piece has sold, so its debts are final. */
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
 * Whether stacks can be shared out so every holder ends on exactly their entitlement.
 *
 * A holder is entitled to `bundles * shares / weight` stacks, and a stack is whole, so a drop
 * divides by looting alone only when that is a whole number for every one of them. A duo on 3
 * stacks cannot: 1.5 each, and somebody walks off with the odd one.
 *
 * Measured on FOLDED holders, never on seats. Three stacks between three characters where one
 * person brought two of them divides perfectly, and reading it per seat would report a debt that
 * does not exist.
 */
export function dividesEvenly(bundles: number, holders: FoldedSeat[]): boolean {
  const weight = holders.reduce((sum, h) => sum + h.shares, 0);
  if (weight <= 0) return false;
  return holders.every((h) => (bundles * h.shares) % weight === 0);
}

/**
 * The seats that ran the week THIS drop fell in.
 *
 * A pool spans months and `party.members` is one week's answer, whichever week the page happened to
 * ask for. So measuring an August drop against September's roster owes a share to somebody who was
 * not there, which is the wrong number this file exists to avoid. The loot row carries
 * `ranThatWeek` for exactly this, and loot-row.tsx and lot-sale.ts have read it all along.
 *
 * Falls back to `party.members` when the week names nobody. That is a party whose every seat has
 * been retired, where the drop's week has no answer at all and the page's week is the only one
 * there is. Reading it as an empty roster instead would say none of the drop is yours.
 */
export function ranSeats(loot: Loot, party: Party): PartyMember[] {
  const ran = party.seats.filter((seat) => loot.ranThatWeek.includes(seat.id));
  // On the share that was in force THAT WEEK, not the one the party is on now. A deal agreed today
  // must not re-divide a drop from a week somebody has already been shown a figure for, which is
  // what pinSharesBefore froze and this is what reads it. Absent is the standing share, which is
  // every week nobody has changed the deal behind, and every row written before V55.
  const shares = loot.sharesThatWeek ?? {};
  return (ran.length > 0 ? ran : party.members).map((seat) =>
    seat.id in shares ? { ...seat, shares: shares[seat.id]! } : seat,
  );
}

/** Those seats folded to the people behind them. Empty when there is nothing to divide. */
function holdersOf(loot: Loot, party: Party): FoldedSeat[] {
  const ran = ranSeats(loot, party);
  if (ran.length < 2) return [];
  return foldSeats(ran);
}

/**
 * What each holder walked away with, or null when nobody has said and it matters.
 *
 * Three ways a night can be known, and one way it cannot, in this order:
 *
 *  - a recorded arrangement, stack by stack, folded to holders.
 *  - a named looter, who holds the lot. What a party running one seller means.
 *  - neither, but the stacks divide, so everybody took exactly their share.
 *
 * Otherwise null. The drop did not divide, nobody has said who took the odd stack, and there is no
 * honest default: a guess is right half the time and names the wrong person the rest.
 *
 * The ARRANGEMENT comes first, and it used to come second. `looterMemberId` is a standing agreement
 * about the party ("one of us loots the lot"); `bundlesBy` is what happened on one night. A specific
 * observation has to beat a general default, and losing to it meant a mis-looted night could not be
 * corrected at all while the party had a looter: you entered the stacks, the card did not move, and
 * nothing said why. See #289.
 */
function heldByHolder(loot: Loot, party: Party, holders: FoldedSeat[]): Map<string, Pile> | null {
  const bundles = bundlesOf(loot);
  const bundlesBy = loot.bundlesBy ?? [];

  if (bundlesBy.length > 0 && bundles !== null && bundles > 0) {
    // Stacks are equal, so a seat's pieces are its stacks times the stack size. Whole by
    // construction: the seed refuses a total that does not divide by its bundle count.
    const size = loot.quantity / bundles;
    const seat = new Map(party.seats.map((s) => [s.id, s]));
    const held = new Map<string, Pile>();
    for (const row of bundlesBy) {
      const picked = seat.get(row.memberId);
      if (!picked) return null;
      const key = holderKey(holderOf(picked));
      const seen = held.get(key);
      if (seen) {
        seen.pieces += row.bundles * size;
        // One person can bend down twice. Both characters are named, because which of them is
        // holding the coupons is the thing the row exists to tell them.
        if (!seen.by.includes(picked.name)) seen.by = `${seen.by}, ${picked.name}`;
      } else {
        held.set(key, { pieces: row.bundles * size, by: picked.name });
      }
    }
    return held;
  }

  if (party.looterMemberId !== null) {
    const looter = party.seats.find((s) => s.id === party.looterMemberId);
    if (looter) {
      const key = holderKey(holderOf(looter));
      return new Map([[key, { pieces: loot.quantity, by: looter.name }]]);
    }
  }

  if (bundles !== null && dividesEvenly(bundles, holders)) {
    const weight = holders.reduce((sum, h) => sum + h.shares, 0);
    return new Map(
      holders.map((h) => [h.key, { pieces: (loot.quantity * h.shares) / weight, by: h.name }]),
    );
  }
  return null;
}

/** One holder's pieces from one drop, and which of their characters bent down for them. */
type Pile = { pieces: number; by: string };

/**
 * How many stacks a drop fell in, with a row that predates the field reading as uncounted.
 *
 * The cache in lib/cache.ts holds whatever shape the API had when the page last fetched, typed as
 * whatever it is read back as. So a tab open across a deploy that adds a field hands this code a
 * row without it, and `undefined !== null` is TRUE: the checks would pass and the arithmetic would
 * run on nothing, which is a NaN on screen rather than an error anybody sees.
 *
 * Absent and null are the same answer here, so say so once rather than at four call sites.
 */
function bundlesOf(loot: Loot): number | null {
  return loot.bundles ?? null;
}

/** A drop nobody can be paid for yet, because who took the odd stack has not been said. */
export type UnansweredDrop = {
  lootId: string;
  partyId: string;
  bossKey: string | null;
  weekStart: string;
  quantity: number;
  /** How many whole stacks it fell in. */
  bundles: number;
  /**
   * The seats that ran that week, which is who a stack may be handed to.
   *
   * Carried rather than read off the party by the card: the party's roster is the week the page
   * asked for, so a guest who ran the night this drop fell would not be offered a stack they are
   * holding.
   */
  seats: PartyMember[];
  /**
   * Pieces that cannot be where they belong, whoever picked up what.
   *
   * Known exactly even though the direction is not: the arrangement closest to even is forced, so
   * the SIZE of the imbalance follows from the stacks and the shares alone. It is the one useful
   * thing that can be said about a night nobody has answered for.
   */
  imbalance: number;
};

/**
 * Drops that did not divide and that nobody has answered for.
 *
 * These owe somebody, and until the arrangement is recorded there is no saying who. Listed rather
 * than dropped: outstanding() used to skip every party with no looter, so an uneven night filed a
 * row and recorded no debt at all, silently. A missing item beats a wrong count, but a missing item
 * still has to be visible.
 */
export function unanswered(
  parties: Party[],
  pools: PartyLootPool[],
  dropKey: string,
): UnansweredDrop[] {
  const partyById = new Map(parties.map((p) => [p.id, p]));
  const out: UnansweredDrop[] = [];

  for (const pool of pools) {
    const party = partyById.get(pool.partyId);
    if (!party) continue;

    for (const loot of pool.loot) {
      const bundles = bundlesOf(loot);
      if (loot.dropKey !== dropKey || loot.quantity < 1 || bundles === null) continue;
      // Per drop, not per pool: a party that ran as a trio in July and a duo in August divides its
      // two nights differently, and one roster for the pool would answer for the wrong one.
      const holders = holdersOf(loot, party);
      if (holders.length < 2) continue;
      const weight = holders.reduce((sum, h) => sum + h.shares, 0);
      if (heldByHolder(loot, party, holders) !== null) continue;

      // What the closest-to-even arrangement still leaves misplaced. Halved because every piece
      // over somebody's share is the same piece under somebody else's, counted once from each end.
      const size = loot.quantity / bundles;
      const drift = holders.reduce((sum, h) => {
        const entitled = (loot.quantity * h.shares) / weight;
        return sum + Math.abs(Math.round(entitled / size) * size - entitled);
      }, 0);

      out.push({
        lootId: loot.id,
        partyId: pool.partyId,
        bossKey: loot.bossKey,
        weekStart: loot.weekStart,
        quantity: loot.quantity,
        bundles,
        seats: ranSeats(loot, party),
        imbalance: Math.round(drift / 2),
      });
    }
  }
  return out;
}

/**
 * How far ahead or behind each holder is across every drop already answered for.
 *
 * Positive is owed pieces, negative is holding somebody else's. Only what has been recorded, so it
 * moves when an earlier week is edited. That is why it may only ever SUGGEST an arrangement and
 * never be stored as one: a stored figure derived from this would be rewritten by the next edit.
 */
export function runningBalance(drops: OutstandingDrop[]): Map<string, number> {
  const out = new Map<string, number>();
  // One drop has a row per pile, and every row carries the same whole-drop seat list, so counting
  // each row's balances would count the drop once per pile it sits in.
  const seen = new Set<string>();
  for (const d of drops) {
    if (seen.has(d.lootId)) continue;
    seen.add(d.lootId);
    for (const b of balances(d.drop.total, d.drop.seats)) {
      out.set(b.memberId, (out.get(b.memberId) ?? 0) + b.balance);
    }
  }
  return out;
}

/**
 * The arrangement to put in front of somebody, before they say what actually happened.
 *
 * Balanced, because that is the one that moves the least: entitlement is `bundles * shares /
 * weight` stacks, everyone takes the floor, and the odd stacks go to the biggest fractions. Any
 * more concentrated arrangement crosses more value, and every piece that crosses pays the fee
 * twice.
 *
 * The odd stack goes to whoever is furthest BEHIND, so it rotates on its own and the debts
 * alternate direction instead of piling up one way. A party that does not want it to rotate says so
 * with its SHARES: taking four of six stacks permanently is being entitled to four of six, and said
 * that way it divides exactly and there is no odd stack to hand anybody.
 *
 * A suggestion: nothing is written until somebody says this is what happened.
 */
export function suggestArrangement(
  bundles: number,
  seats: PartyMember[],
  behind: Map<string, number>,
): Map<string, number> {
  const weight = seats.reduce((sum, s) => sum + s.shares, 0);
  if (seats.length === 0 || weight <= 0 || bundles <= 0) return new Map();

  const exact = seats.map((s) => (bundles * s.shares) / weight);
  const share = exact.map(Math.floor);
  let left = bundles - share.reduce((sum, n) => sum + n, 0);

  const order = seats
    .map((s, i) => ({
      i,
      fraction: (exact[i] ?? 0) - (share[i] ?? 0),
      // Their HOLDER's position, not the seat's: two characters of one person are one pile, and
      // giving the odd stack to their second character would not move the debt at all.
      owed: behind.get(holderKey(holderOf(s))) ?? 0,
    }))
    .sort((a, b) => b.fraction - a.fraction || b.owed - a.owed || a.i - b.i);

  for (const { i } of order) {
    if (left <= 0) break;
    share[i] = (share[i] ?? 0) + 1;
    left -= 1;
  }
  // A seat with no stacks is left out rather than given a zero: the server refuses a zero, because
  // somebody who did not bend down is absent from the arrangement, not present with none.
  const out = new Map<string, number>();
  seats.forEach((s, i) => {
    if ((share[i] ?? 0) > 0) out.set(s.id, share[i]!);
  });
  return out;
}

/**
 * Every drop that still owes somebody, oldest first.
 *
 * One row per HOLDER holding pieces of a drop, not one per drop. A drop looted stack by stack sits
 * in several piles at once, each draining its own owner's tranches, and one row could only ever
 * describe one of them.
 *
 * A drop owes nothing and is left out when every pile matches its owner's share: a party whose
 * stacks divide, or one whose seats are all ONE person however many characters they brought. What
 * is NOT left out any more is the night that did not divide with no arrangement recorded. That is
 * `unanswered()`, and it used to vanish from here without a word.
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
    if (!party) continue;

    for (const loot of pool.loot) {
      if (loot.dropKey !== dropKey || loot.quantity < 1) continue;
      // Who ran THAT WEEK is who the shares are measured against, the same list a payout uses. Seats
      // folded to holders: two characters of one person are one share of the drop and one party to
      // the debt, so a night that folds to a single holder is nobody owing anybody.
      const holders = holdersOf(loot, party);
      if (holders.length < 2) continue;
      const byKey = new Map(holders.map((h) => [h.key, h]));
      const held = heldByHolder(loot, party, holders);
      if (held === null) continue;

      const seats = holders.map((h) => ({
        memberId: h.key,
        name: h.name,
        looted: held.get(h.key)?.pieces ?? 0,
        shares: h.shares,
      }));
      // Everybody is exactly on their share, so there is nothing to settle and no pile to queue.
      if (balances(loot.quantity, seats).every((b) => b.balance === 0)) continue;

      for (const [key, pile] of held) {
        const holder = byKey.get(key);
        if (!holder || pile.pieces < 1) continue;
        out.push({
          lootId: loot.id,
          partyId: pool.partyId,
          bossKey: loot.bossKey,
          holder: holder.holder,
          holderName: holder.name,
          looterName: pile.by,
          drop: {
            id: loot.id,
            weekStart: loot.weekStart,
            order: bossOrder.get(loot.bossKey ?? "") ?? Number.MAX_SAFE_INTEGER,
            total: loot.quantity,
            held: pile.pieces,
            seats,
          },
        });
      }
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
  /**
   * Pieces each holder is redeeming rather than selling. Absent is none, which is every pile before
   * V46 and still most of them.
   */
  keptByHolder: Map<string, number> = new Map(),
  /** Pieces of yours each holder bought outright, and what they agreed to pay. See V50. */
  boughtByHolder: Map<string, { pieces: number; paid: number }> = new Map(),
  /** Mesos that have actually arrived from each holder. See V51. */
  receivedByHolder: Map<string, number> = new Map(),
  /**
   * Which (holder, drop) pairs have had their books closed, and what was written off. See V52.
   *
   * Closed drops STAY in the pile here, because the tranches were spent across all of it and dropping
   * them would re-price what is left. Only what the card draws changes.
   */
  closures: { closed: Set<string>; writtenOff: Map<string, number> } = {
    closed: new Set(),
    writtenOff: new Map(),
  },
): HolderLedger[] {
  const byHolder = new Map<string, OutstandingDrop[]>();
  for (const d of drops) {
    const seen = byHolder.get(holderKey(d.holder));
    if (seen) seen.push(d);
    else byHolder.set(holderKey(d.holder), [d]);
  }

  const ledgers: HolderLedger[] = [];
  for (const [key, mine] of byHolder) {
    const kept = keptByHolder.get(key) ?? 0;
    // Which bosses the redeemed pieces came off, before anything is priced: coverage and every
    // transfer are measured against the sellable pile, so this has to be decided first. Keyed by
    // the holder so their own share of each drop is redeemed before anything they owe.
    //
    // One lootId appears at most once per holder, so keying by it inside this pile is safe. Across
    // piles it does not hold, which is why this runs per holder rather than over the whole list.
    // Redemptions before purchases, because they come off different halves of the pile and the
    // purchase is capped by what the redemption left sellable. Reversed, a redemption bounded by
    // their own share could find that share already spent.
    const bought = boughtByHolder.get(key) ?? { pieces: 0, paid: 0 };
    const spread = new Map(
      spreadBought(
        spreadKept(
          mine.map((d) => d.drop),
          kept,
          key,
        ),
        bought.pieces,
        bought.paid,
        key,
      ).map((d) => [d.id, d]),
    );
    const pileOf = (d: OutstandingDrop) => spread.get(d.drop.id) ?? d.drop;

    const sales = salesByHolder.get(key) ?? [];
    const soldPieces = sales.reduce((sum, s) => sum + s.pieces, 0);
    const coverage = allocate(mine.map(pileOf), sales);
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
      const pile = pileOf(d);
      const cover = coverage.get(pile.id);
      return {
        lootId: d.lootId,
        partyId: d.partyId,
        bossKey: d.bossKey,
        weekStart: d.drop.weekStart,
        looterName: d.looterName,
        // What is in THIS pile, which is what their own sales can cover. The whole drop would
        // count somebody else's stacks as unsold pieces of theirs.
        pieces: heldOf(pile),
        kept: pile.kept ?? 0,
        bought: pile.bought ?? null,
        closed: closures.closed.has(closureKey(d.holder, d.lootId)),
        sellable: cover?.sellable ?? sellableOf(pile),
        covered: cover?.covered ?? 0,
        complete: cover?.complete ?? false,
        averagePrice: cover?.averagePrice ?? null,
        // Only what THIS holder owes. A split drop has a row in each pile it sits in, and every one
        // of them would otherwise repeat the whole drop's debts, counting each of them once per
        // pile.
        transfers: transfersOf(pile, cover, key),
      };
    });
    // Your side of this pile, read off the transfers rather than recomputed: whatever they are
    // told to send you is what you are owed, and two sums of that would be two answers.
    const yours = drops.flatMap((d) => d.transfers).filter((t) => t.toId === SELF_KEY);

    const dueNow = yours.reduce((sum, t) => sum + (t.send ?? 0), 0);
    const received = receivedByHolder.get(key) ?? 0;
    const owedToYou = yours.reduce((sum, t) => sum + t.pieces, 0);
    const settledToYou = yours.reduce((sum, t) => sum + t.settled, 0);

    ledgers.push({
      holder: mine[0]!.holder,
      holderName: mine[0]!.holderName,
      pieces: mine.reduce((sum, d) => sum + heldOf(d.drop), 0),
      owedToYou,
      settledToYou,
      dueNow,
      received,
      // Every piece of yours accounted for, and the money here. A pile you owe nothing on is settled
      // the moment it is priced, which is what makes your OWN card read as done rather than as a debt
      // of zero waiting on a payment of zero.
      settled: settledToYou === owedToYou && received >= dueNow,
      kept,
      ownShare: mine.reduce((sum, d) => sum + ownShareOf(d.drop, key), 0),
      bought,
      soldPieces,
      accounted: soldPieces + kept + bought.pieces,
      // Every drop closed, so there is nothing here anybody is waiting on. A pile with no drops at all
      // cannot be closed: there would be nothing to have decided about.
      closed: drops.length > 0 && drops.every((d) => d.closed),
      writtenOff: closures.writtenOff.get(key) ?? 0,
      drops,
    });
  }
  // Settled piles last, then by name. Still listed, because the tranches and receipts that made them
  // settled are corrected from this card and nowhere else, so dropping it would put a mistyped row
  // beyond reach. Out of the way is not the same as gone.
  return ledgers.sort(
    (a, b) =>
      Number(a.closed) - Number(b.closed) ||
      Number(a.settled) - Number(b.settled) ||
      a.holderName.localeCompare(b.holderName),
  );
}

/**
 * One tranche as these functions read it. `disposition` absent is a row cached from before V50.
 *
 * Named because three readers now have to agree on it, and on what an ABSENT disposition means.
 */
type TrancheRow = { holder: Holder; pieces: number; amount: number | null; disposition?: string };

/**
 * Whether a row is a purchase of the creditor's pieces rather than a sale. See V50.
 *
 * The one place `disposition` is read, and it is read POSITIVELY: absent can only mean a row cached
 * from before BOUGHT existed, so it is never one. Testing for SOLD instead would be the cache trap
 * in `bundlesOf` below, and worse: lib/cache.ts hands back whatever shape the API had when the page
 * last fetched, and `undefined !== "SOLD"` is TRUE, so a tab open across the deploy would drop every
 * sale already entered.
 */
function isBought(row: TrancheRow): boolean {
  return row.disposition === "BOUGHT";
}

/**
 * The sales one holder has entered, keyed the way holderLedgers wants them.
 *
 * Rows with money in them, minus the purchases. A KEPT row is pieces redeemed rather than sold, so it
 * has no price to spend on the queue; what those pieces do instead is come out of the sellable pile,
 * which is `keptByHolder` below. A BOUGHT row has a price and is still not a sale: the money is one
 * creditor's in full rather than the pile's to divide, so spending it on the queue would hand a slice
 * of it to everybody else.
 *
 * The AMOUNT is what separates a sale from a redemption, which V50 keeps equivalent by check
 * constraint. Only the purchase needs the disposition, and `isBought` says why that direction is the
 * safe one to test.
 */
export function salesByHolder(rows: TrancheRow[]): Map<string, PieceSale[]> {
  const out = new Map<string, PieceSale[]>();
  for (const row of rows) {
    if (row.amount === null || isBought(row)) continue;
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

/**
 * How many pieces each holder is redeeming rather than selling.
 *
 * A total, because only the total matters: which bosses the pieces come off is decided on read by
 * `spreadKept`, and the rows exist separately so a redemption entered by mistake can be removed.
 *
 * Rows with no money, the same test `salesByHolder` uses and for the same reason: V46 makes the
 * amount and the disposition equivalent by check constraint, and reading `disposition` would read
 * `undefined` on a response cached from before the field existed.
 */
export function keptByHolder(rows: TrancheRow[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rows) {
    if (row.amount !== null) continue;
    const key = holderKey(row.holder);
    out.set(key, (out.get(key) ?? 0) + row.pieces);
  }
  return out;
}

/**
 * Pieces of the creditor's that each holder bought, and what they paid for them. See V50.
 *
 * One count and one total per holder, so several purchases at different prices blend. Which boss each
 * bought piece came off is decided on read by `spreadBought`, for the same reason a sale names none:
 * a coupon in an inventory carries no record of the clear it fell on.
 */
export function boughtByHolder(rows: TrancheRow[]): Map<string, { pieces: number; paid: number }> {
  const out = new Map<string, { pieces: number; paid: number }>();
  for (const row of rows) {
    if (!isBought(row) || row.amount === null) continue;
    const key = holderKey(row.holder);
    const seen = out.get(key);
    if (seen) {
      seen.pieces += row.pieces;
      seen.paid += row.amount;
    } else out.set(key, { pieces: row.pieces, paid: row.amount });
  }
  return out;
}

/**
 * The key a closure is remembered by: one holder's decision about one drop.
 *
 * Both halves, because a drop split at the stack sits in several piles and closing one person's books
 * says nothing about anybody else's.
 */
export function closureKey(holder: Holder, lootId: string): string {
  return `${holderKey(holder)}|${lootId}`;
}

/** Every (holder, drop) whose books are closed, and what each act wrote off. See V52. */
export function closedByHolder(rows: { holder: Holder; lootIds: string[]; unpaid: number }[]): {
  closed: Set<string>;
  writtenOff: Map<string, number>;
} {
  const closed = new Set<string>();
  const writtenOff = new Map<string, number>();
  for (const row of rows) {
    for (const lootId of row.lootIds) closed.add(closureKey(row.holder, lootId));
    const key = holderKey(row.holder);
    writtenOff.set(key, (writtenOff.get(key) ?? 0) + row.unpaid);
  }
  return { closed, writtenOff };
}

/**
 * The drops a holder still has open, which is what a rotation should be measured against.
 *
 * A closed debt was compensated, so it has no business tilting next week's suggested arrangement: a
 * holder who took the odd stack four weeks running and paid for it every time would otherwise keep
 * being suggested against forever.
 */
export function stillOpen(drops: OutstandingDrop[], closed: Set<string>): OutstandingDrop[] {
  return drops.filter((d) => !closed.has(closureKey(d.holder, d.lootId)));
}

/**
 * Mesos each holder has actually handed over. See V51.
 *
 * A total, like the redemptions: what a holder still owes is one number, and which boss a meso
 * retires is already the queue's answer. The rows exist separately so a mistyped receipt can be
 * removed the way a mistyped tranche is.
 */
export function receivedByHolder(rows: { holder: Holder; amount: number }[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rows) {
    const key = holderKey(row.holder);
    out.set(key, (out.get(key) ?? 0) + row.amount);
  }
  return out;
}

/**
 * Mesos still to come from a holder, floored at zero. Overpayment is said, not folded away.
 *
 * Floored because a negative "to come" reads as the holder being owed, which they are not: too much
 * arriving is a miscount on one side or the other, and the card names it rather than netting it off.
 */
export function toCome(ledger: HolderLedger): number {
  return Math.max(0, ledger.dueNow - ledger.received);
}

/**
 * Pieces of the pile nobody has said the fate of yet. Floored, so a miscount does not read negative.
 *
 * The card's one instruction while there are any: this many pieces are in somebody's inventory and
 * the ledger has not been told what became of them. Zero is every piece accounted for, which is when
 * the money becomes the only question left.
 */
export function unaccounted(ledger: HolderLedger): number {
  return Math.max(0, ledger.pieces - ledger.accounted);
}

/**
 * Pieces still to sell across a holder's whole pile. What the card's header counts down.
 *
 * Against the SELLABLE part of each pile, so a redeemed piece is not something still to be entered.
 * Counted against the whole pile it never reached zero for a holder redeeming any of theirs, and the
 * card could not tell a pile that had stalled for good from one still waiting on a sale.
 */
export function unsold(ledger: HolderLedger): number {
  return ledger.drops.reduce((sum, d) => sum + (d.sellable - d.covered), 0);
}

/**
 * Every pile this loot row sits in, for the row's own read-only display.
 *
 * A list, not one entry: a drop looted stack by stack is in as many piles as there were people
 * bending down, and answering with the first would name one holder and quietly drop the others.
 * One entry is the ordinary case, where a single looter holds the lot.
 */
export function ledgerForLoot(
  ledgers: HolderLedger[],
  lootId: string,
): { holderName: string; drop: HolderLedger["drops"][number] }[] {
  return ledgers.flatMap((ledger) =>
    ledger.drops
      .filter((d) => d.lootId === lootId)
      .map((drop) => ({ holderName: ledger.holderName, drop })),
  );
}
