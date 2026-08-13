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
import type { HolderLedger } from "./vestige-ledger";

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
 * What the card's queue lists, and what it says as a count instead.
 *
 * Only the nights that owe somebody get a row. A night that divided the way it fell is finished when
 * it is logged: nothing is derived from what became of those coupons, so its row carried a boss, a
 * looter, a week and no question. Those are the majority of any pile, so drawn they WERE the queue,
 * and the handful of rows with a debt under them were lost in it.
 *
 * Neither absence is silent. A count that changed still gets said, so both go on screen as counts,
 * the way a closed boss already did. See V52 and CLAUDE.md.
 */
export function queueOf(ledger: HolderLedger): { owing: Night[]; clean: number; closed: number } {
  const open = ledger.drops.filter((d) => !d.closed);
  const owing = open.filter((d) => d.transfers.length > 0);
  return { owing, clean: open.length - owing.length, closed: ledger.drops.length - open.length };
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
