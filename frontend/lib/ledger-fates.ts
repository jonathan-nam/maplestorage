// What a pile can be told became of its pieces, and how many each answer has room for.
//
// Split out of the card because of the way this goes wrong. A fate left off is not a missing
// control, it is a pile that can never reach "all accounted for": the count sits short and the card
// asks forever, with nothing on screen saying which answer it is waiting for.
//
// That is what BOUGHT being somebody else's fate did to your own card. You cannot buy your own
// coupons, which is true and is not what the option is for: it takes the pieces in a pile that are
// NOT the holder's, and your inventory holds those every time a night did not divide your way.
// Without it they could only be sold, so a pile you meant to keep never finished.
//
// `coversThePile` is that property, stated once so a test can hold it.
//
// The other half is `asksAnything`: WHETHER a pile has a question at all. Since #354 deleted the
// apportioning, no debt is derived from these rows, so a pile that owes nobody gets the same figures
// whatever it is told. Asking it to account for itself is work with no reader.

import { holderKey, unaccounted } from "./vestige-ledger";
import type { Holder, HolderLedger } from "./vestige-ledger";

/** Every answer a pile can be given. All three, on every card, whoever is holding it. */
export const FATES = ["SOLD", "KEPT", "BOUGHT"] as const;

export type Fate = (typeof FATES)[number];

/**
 * How many pieces this fate has room for.
 *
 * A redemption stops at the holder's OWN share and a purchase at what is left over, because the
 * pieces past their share are not theirs to redeem. Bounding the redemption is only safe because the
 * purchase exists to take what it turns away: clamping with nowhere for the surplus to go would
 * record 195 of a 250 that really happened and leave 55 pieces waiting on a sale that is not coming.
 * See V50.
 *
 * A sale is bounded only by what is unaccounted for. It is not a claim about whose pieces they were,
 * so there is no share to measure it against.
 *
 * Rows already entered count against all three, so three of them cannot walk past what one cannot.
 */
export function roomFor(ledger: HolderLedger, fate: Fate): number {
  const left = unaccounted(ledger);
  if (fate === "KEPT") return Math.min(left, Math.max(0, ledger.ownShare - ledger.kept));
  if (fate === "BOUGHT")
    return Math.min(left, Math.max(0, ledger.pieces - ledger.ownShare - ledger.bought.pieces));
  return left;
}

/**
 * Whether the answers on offer can between them account for the whole pile without a sale.
 *
 * The invariant the card is built on, and the one thing about the fate list that cannot be seen by
 * looking at it. Every piece is either the holder's own or somebody else's, so a redemption and a
 * purchase cover the pile between them and nobody is forced to sell a coupon to make the count come
 * out. False means a pile has pieces with no honest answer, whoever holds it.
 */
export function coversThePile(ledger: HolderLedger): boolean {
  return roomFor(ledger, "KEPT") + roomFor(ledger, "BOUGHT") >= unaccounted(ledger);
}

/**
 * Pieces this pile owes somebody, across the drops still open.
 *
 * Off the transfers, which are already filtered to what THIS holder owes, so a pile you are merely
 * the creditor of counts zero: what they are holding of yours is the Settlement Ledger's to say.
 */
export function owes(ledger: HolderLedger, heldOfYours: HeldOfYours = new Map()): number {
  const byCreditor = new Map<string, number>();
  for (const drop of ledger.drops) {
    if (drop.closed) continue;
    for (const transfer of drop.transfers) {
      byCreditor.set(transfer.toId, (byCreditor.get(transfer.toId) ?? 0) + transfer.pieces);
    }
  }
  let total = 0;
  for (const [creditor, pieces] of byCreditor) {
    // PER CREDITOR, and floored there. Owing Bro 90 while Bro holds 20 of yours is 70 changing
    // hands, but owing Bro 90 while JARED holds 20 of yours is still 90: netting across two people
    // would ask one of them to settle the other's debt, which is the cross-person netting this app
    // refuses. Floored, because a creditor holding more of yours than you owe them is a debt the
    // other way and belongs on their own card.
    total += Math.max(0, pieces - (heldOfYours.get(creditor) ?? 0));
  }
  return total;
}

/** Pieces of THIS pile's holder that each other pile is sitting on, keyed by the pile holding them. */
export type HeldOfYours = Map<string, number>;

/**
 * Who this pile owes, and how many each, after their own coupons come off.
 *
 * The same per-creditor subtraction `owes` totals, kept apart so the card can name them. A count with
 * nobody's name on it is the state this was reported in: "owes 90 pieces" over a pile whose whole debt
 * was one person's, and no way to tell from the card which person.
 *
 * Biggest first, and a creditor who nets to nothing drops out: they are square, and the pile has
 * nothing to say to them.
 */
export function owedByCreditor(
  ledger: HolderLedger,
  heldOfYours: HeldOfYours = new Map(),
): { key: string; name: string; pieces: number }[] {
  const byCreditor = new Map<string, { name: string; pieces: number }>();
  for (const drop of ledger.drops) {
    if (drop.closed) continue;
    for (const transfer of drop.transfers) {
      const seen = byCreditor.get(transfer.toId);
      if (seen) seen.pieces += transfer.pieces;
      else byCreditor.set(transfer.toId, { name: transfer.to, pieces: transfer.pieces });
    }
  }
  return [...byCreditor.entries()]
    .map(([key, { name, pieces }]) => ({
      key,
      name,
      pieces: Math.max(0, pieces - (heldOfYours.get(key) ?? 0)),
    }))
    .filter((row) => row.pieces > 0)
    .sort((a, b) => b.pieces - a.pieces || a.name.localeCompare(b.name));
}

/**
 * That map, off the other piles' own figures rather than recomputed.
 *
 * `owedToYou` is already "pieces of yours this pile holds, open drops only", so this is a re-keying
 * and not a second reading of the transfers. Your own pile is skipped: it cannot hold your pieces
 * against you.
 */
export function heldOfYoursBy(ledgers: HolderLedger[]): HeldOfYours {
  const out: HeldOfYours = new Map();
  for (const ledger of ledgers) {
    if (ledger.holder.kind === "SELF" || ledger.closed) continue;
    if (ledger.owedToYou > 0) out.set(holderKey(ledger.holder), ledger.owedToYou);
  }
  return out;
}

/**
 * How a sale out of your own pile lands on the people it owes, without being asked.
 *
 * The pieces you owe go out first, biggest debt first, each capped at what that person is owed, and
 * whatever is left over is your own. So a sale is two numbers again: how many went, and for how much.
 *
 * This reverses #362's "ask me, per sale", and the reason it can is that the arrangement is recorded
 * per night now. What the box was guarding against was crediting real money off a guess at a mixed
 * pile; the answer it wanted is the one thing the ledger already knows exactly, which is who is short
 * and by how much. What it still is not is a claim about WHICH physical coupons went to market: it is
 * a statement that this much of the money is theirs, which is what the debt was in.
 *
 * Feed it the NETTED debts (owedByCreditor), never pieceCreditors: that one sums transfers gross, so a
 * creditor holding coupons of yours would be credited for pieces they are already sitting on.
 *
 * Biggest first is arbitrary between two creditors and has to be: no order can be read off the
 * coupons. It is deterministic, capped, and the row says what it did, which is what makes it
 * correctable rather than a guess nobody can see.
 */
export function distributeSale<T extends { key: string; pieces: number }>(
  pieces: number,
  creditors: T[],
): { creditor: T; pieces: number }[] {
  let left = Math.max(0, Math.floor(pieces));
  const out: { creditor: T; pieces: number }[] = [];
  for (const creditor of [...creditors].sort(
    (a, b) => b.pieces - a.pieces || a.key.localeCompare(b.key),
  )) {
    if (left <= 0) break;
    const cut = Math.min(left, creditor.pieces);
    if (cut <= 0) continue;
    out.push({ creditor, pieces: cut });
    left -= cut;
  }
  return out;
}

/**
 * How much of what this pile owes has been answered, in pieces.
 *
 * A redemption is the holder's own share by definition, so it settles nothing they owe. The other two
 * both do, and by the same means: the creditor gets a FIGURE instead of their coupons, on their
 * Settlement card. A purchase is that agreement outright (V50), and a sale is it at the price the
 * market paid, once the sale says whose pieces were in it (V56).
 *
 * That last clause is what #362 changed. Before it, a sale of a mixed pile could not say which of the
 * coupons went out, so it answered for nothing and the pile asked forever. Do not read the old rule
 * back in: the pieces are priced, and the debt is on the other ledger in mesos.
 *
 * Both routes are counted in one place, answeredByHolder, so a purchase that named its creditor
 * cannot be counted once as a purchase and again as an attribution.
 *
 * Capped, because a holder may have bought pieces on a night whose books were later closed.
 */
export function settledOf(ledger: HolderLedger, heldOfYours: HeldOfYours = new Map()): number {
  return Math.min(owes(ledger, heldOfYours), ledger.answered);
}

/**
 * Whether the card has a question, or is only somewhere a sale MAY be recorded.
 *
 * A night that divided the way it fell is finished when it is logged. Nothing is derived from what
 * became of those coupons, so "0 of 1140 pieces accounted for" asked for 1140 pieces of typing to
 * move a figure nobody reads. The count is an instruction, and an instruction with no consequence is
 * the narration this app's screens are not allowed to carry.
 *
 * What is asked is the DEBT, not the pile: of 1160 coupons in your inventory, 1150 are your own and
 * nobody is waiting on them. Counting the pile demanded 1160 answers for a 10-piece debt.
 *
 * Over-entry still speaks, whoever holds the pile: more entered than the pile holds is a miscount,
 * and a card that went quiet about it would be hiding what it dropped rather than saying it short.
 */
export function asksAnything(ledger: HolderLedger, heldOfYours: HeldOfYours = new Map()): boolean {
  return (
    settledOf(ledger, heldOfYours) < owes(ledger, heldOfYours) || ledger.accounted > ledger.pieces
  );
}

/** One night under a pile, as the queue reads it. */
type Night = HolderLedger["drops"][number];

/**
 * Which nights a creditor's answered pieces have finished, oldest night first.
 *
 * The gate used to be the whole pile: while any of it was outstanding EVERY night stayed up, on the
 * reasoning that a tranche names a person and never a boss, so picking some would be a guess about
 * which coupons went to market. The cost of that was not a guess avoided, it was five settled nights
 * coming back the moment a sixth was entered: 150 pieces answered, one new 30-piece night logged,
 * and the queue went from nothing to six rows including the five already sold. A night that has been
 * answered for is finished, and a night logged today cannot un-finish it.
 *
 * Oldest first, by the day the night FELL. A sale cannot have come off a night that had not happened
 * yet, which is the same reckoning receivedSinceClosing applies to money (#350). Not the order the
 * rows are drawn in: that is the catalog's, so two bosses in one week never swap places, and it is
 * not the order the nights happened in.
 *
 * PER CREDITOR, never pooled. Bro's sold coupons cannot finish a night owed to Jared, which is the
 * cross-person netting `owes` already refuses.
 *
 * Stops at the first night its creditors cannot cover, rather than skipping on to a smaller one it
 * could. Leftover credit going unspent leaves a night on screen that is nearly finished, which is
 * the safe direction: this fold HIDES rows, so it errs towards showing one too many.
 */
function foldAnswered(ledger: HolderLedger, owing: Night[], heldOfYours: HeldOfYours): Set<string> {
  const credit = new Map<string, number>();
  for (const night of owing) {
    for (const transfer of night.transfers) {
      if (credit.has(transfer.toId)) continue;
      credit.set(
        transfer.toId,
        (heldOfYours.get(transfer.toId) ?? 0) + (ledger.answeredByCreditor.get(transfer.toId) ?? 0),
      );
    }
  }

  const folded = new Set<string>();
  const oldest = [...owing].sort((a, b) => a.droppedOn.localeCompare(b.droppedOn));
  for (const night of oldest) {
    const owed = new Map<string, number>();
    for (const transfer of night.transfers) {
      owed.set(transfer.toId, (owed.get(transfer.toId) ?? 0) + transfer.pieces);
    }
    // Every creditor of the night, because closing it would say all of them were answered for.
    if (![...owed].every(([key, pieces]) => (credit.get(key) ?? 0) >= pieces)) break;
    for (const [key, pieces] of owed) credit.set(key, (credit.get(key) ?? 0) - pieces);
    folded.add(night.lootId);
  }
  return folded;
}

/**
 * What the card's queue lists, and what it says as a count instead.
 *
 * Only the nights that owe somebody get a row. A night that divided the way it fell is finished when
 * it is logged: nothing is derived from what became of those coupons, so its row carried a boss, a
 * looter, a week and no question. Those are the majority of any pile, so drawn they WERE the queue,
 * and the handful of rows with a debt under them were lost in it.
 *
 * A night whose debt has been ANSWERED is counted too. Its coupons were sold and priced, the money
 * is on somebody's Settlement card, and there is nothing left here to act on or to read: five rows
 * of those sat under a header already saying nothing was outstanding. Same "already dealt with" as
 * a closed boss, and they were the only kind still drawn.
 *
 * Answered NIGHT BY NIGHT, oldest first. See foldAnswered for why, and for the order.
 *
 * No absence is silent. A count that changed still gets said, so all three go on screen as counts,
 * the way a closed boss already did. See V52 and CLAUDE.md.
 */
export function queueOf(
  ledger: HolderLedger,
  heldOfYours: HeldOfYours = new Map(),
): { owing: Night[]; clean: number; closed: number; answered: number } {
  const open = ledger.drops.filter((d) => !d.closed);
  const owing = open.filter((d) => d.transfers.length > 0);
  const folded = foldAnswered(ledger, owing, heldOfYours);
  return {
    owing: owing.filter((d) => !folded.has(d.lootId)),
    clean: open.length - owing.length,
    closed: ledger.drops.length - open.length,
    answered: folded.size,
  };
}

/**
 * What this pile still owes, which is the whole of what the card is for.
 *
 * The header's one figure, and it moves as the debt is answered, so no second line restates it.
 * `holding 1495` stood there before and was a number nobody could act on.
 */
export function outstandingOf(ledger: HolderLedger, heldOfYours: HeldOfYours = new Map()): number {
  return owes(ledger, heldOfYours) - settledOf(ledger, heldOfYours);
}

/**
 * Your own piles, split by whether the Sale Ledger has a reason to draw one.
 *
 * A pile that owes somebody, or one with rows already recorded, is a card: there is something to
 * answer or something to correct. A pile with neither is a place a sale MAY be recorded and nothing
 * else, and drawn anyway it is a permanent "holding 1140" at a reader with nothing to do about it.
 *
 * The quiet ones are held back, not dropped. Dropping them would re-break what `alsoHeldByYou`
 * exists for, which is that a Sale Ledger refusing to admit you hold the coupons cannot take the
 * sale. They come back the moment the reader asks to record one.
 */
export function worthDrawing(
  yours: HolderLedger[],
  recorded: (key: string) => boolean,
  heldOfYours: HeldOfYours = new Map(),
): { drawn: HolderLedger[]; quiet: HolderLedger[] } {
  const drawn: HolderLedger[] = [];
  const quiet: HolderLedger[] = [];
  for (const ledger of yours) {
    const has = asksAnything(ledger, heldOfYours) || recorded(holderKey(ledger.holder));
    (has ? drawn : quiet).push(ledger);
  }
  return { drawn, quiet };
}

/**
 * A pile's recorded tranches, split by whether the row still has anything to say.
 *
 * A tranche that NAMED whose pieces were in it is answered somewhere else, and better: its money is
 * on that person's Settlement card and its pieces have come off what this pile owes them. The pill
 * here is then the record of a finished act, and a card that keeps every one grows a row per sale
 * for as long as the account runs.
 *
 * FOLDED, never dropped, and the count says how many. A mistyped tranche re-prices every boss behind
 * it and this pill is the only place one can be taken back off, so a card that simply forgot them
 * would be a ledger you cannot correct. Same shape as `worthDrawing` above.
 *
 * A share naming the pile's own holder does not count as naming anybody: a pile owes itself nothing.
 * Same rule as `answeredByPair`, and it has to be, or a tranche the two disagree about would vanish
 * from the card while still asking on it.
 */
export function foldTranches<T extends { holder: Holder; shares?: { holder: Holder }[] }>(
  tranches: T[],
): { shown: T[]; folded: T[] } {
  const shown: T[] = [];
  const folded: T[] = [];
  for (const tranche of tranches) {
    const pile = holderKey(tranche.holder);
    const named = (tranche.shares ?? []).some((s) => holderKey(s.holder) !== pile);
    (named ? folded : shown).push(tranche);
  }
  return { shown, folded };
}
