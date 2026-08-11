// What other people owe YOU, in one place.
//
// Two kinds of debt land here and they are not the same kind of thing.
//
// A SHARE of a sale somebody else made is a known figure in mesos: they sold it, the split says what
// your part is, and it is either paid or not.
//
// PIECES are not. Coupons are single-trade, so somebody holding your share cannot hand them back,
// and nothing you can see says what they are worth: the price is whatever they got, or whatever the
// two of you agree. So this states how many pieces of yours they are holding and stops there. It
// used to derive a meso figure by tracking their sales tranche by tranche, which is what made the
// Sale Ledger ask you to enter somebody else's prices.
//
// Neither total is computed here. The shares are lib/wallet.ts's and the pieces are
// lib/vestige-ledger.ts's, and a second copy of either would be a second answer.

import { SELF_KEY, holderKey } from "./vestige-ledger";
import type { Holder, HolderLedger } from "./vestige-ledger";
import type { Wallet, WalletLine } from "./wallet";

/** One night's pieces of yours, sitting in somebody else's inventory. */
export type HeldOfYours = {
  lootId: string;
  partyId: string;
  bossKey: string | null;
  weekStart: string;
  /** Pieces of YOURS they hold, not the size of their pile. */
  pieces: number;
  /** Which of their characters bent down for them. */
  looterName: string;
};

/** One person, and everything of yours they have not handed over yet. */
export type Collection = {
  key: string;
  name: string;
  /**
   * False when nobody has said who plays that character. Then this row is a CHARACTER and the same
   * human may appear twice under two names, which is said rather than guessed at.
   */
  attributed: boolean;
  /**
   * Whose pile, for the payment and the closure this card writes. Null when they owe only shares:
   * those settle against payout rows and need no holder.
   */
  holder: Holder | null;
  /** Pieces of yours they hold. Deliberately unpriced. */
  pieces: number;
  /**
   * Mesos they owe you once both directions are netted off. A real figure, unlike the pieces.
   *
   * NET, because one transfer of the difference is how this is actually settled and it saves a hop's
   * Auction House fee on the value that no longer crosses. Zero when the two sides cancel or you are
   * the one behind, and then `owedByYou` carries it instead.
   */
  mesos: number;
  /**
   * Mesos YOU owe them, when the netting comes out that way. Never collectable, said anyway.
   *
   * A row only reaches the list on its pieces once this is set, and it is there so those pieces are
   * not chased off somebody you are behind with. Settling it is not this ledger's act.
   */
  owedByYou: number;
  /** Mesos that have arrived from them, against the pieces. */
  received: number;
  drops: HeldOfYours[];
  lines: WalletLine[];
};

const blank = (key: string, name: string, attributed: boolean): Collection => ({
  key,
  name,
  attributed,
  holder: null,
  pieces: 0,
  mesos: 0,
  owedByYou: 0,
  received: 0,
  drops: [],
  lines: [],
});

/**
 * One row per person who owes you something, from both ledgers at once.
 *
 * Keyed the way both sides already key a counterparty (`person:<id>` or `character:<name>`), so a
 * person who owes you pieces AND a share is one row rather than two.
 */
export function buildCollection(ledgers: HolderLedger[], wallet: Wallet): Collection[] {
  const out = new Map<string, Collection>();

  // The pieces. Your own pile is not a debt to you, and a closed one is finished.
  for (const ledger of ledgers) {
    if (ledger.holder.kind === "SELF" || ledger.closed) continue;
    // Only the drops still open, and only the part of each that is YOURS: their pile is their
    // business, and counting all of it would state a debt the size of everything they picked up.
    const drops = ledger.drops
      .filter((d) => !d.closed)
      .map((d) => ({
        lootId: d.lootId,
        partyId: d.partyId,
        bossKey: d.bossKey,
        weekStart: d.weekStart,
        pieces: d.transfers
          .filter((t) => t.toId === SELF_KEY)
          .reduce((sum, t) => sum + t.pieces, 0),
        looterName: d.looterName,
      }))
      .filter((d) => d.pieces > 0);
    if (drops.length === 0) continue;

    const key = holderKey(ledger.holder);
    const row = out.get(key) ?? blank(key, ledger.holderName, ledger.holder.kind === "PERSON");
    row.holder = ledger.holder;
    row.pieces = ledger.owedToYou;
    row.received = ledger.received;
    row.drops = drops;
    out.set(key, row);
  }

  // The shares, NETTED: what they owe you less what you owe them, per person. One transfer of the
  // difference is how this is settled, and it saves the 5% hop on the value that no longer crosses.
  //
  // Mesos against mesos only. Pieces are not netted and cannot be: a piece debt has no price until
  // somebody names one, and the two sides come off different nights at different prices, so calling
  // 50 pieces owed against 25 owed "25 pieces" states a figure that matches neither side.
  for (const person of wallet.counterparties) {
    if (person.lines.length === 0) continue;
    const net = person.owed - person.owe;
    const row = out.get(person.key) ?? blank(person.key, person.name, person.attributed);

    if (net > 0) {
      // Every line, both directions, because settling the net marks BOTH sides paid. Two sides that
      // cancel still have shares behind them, and the wallet's own settle names all of them.
      row.lines = person.lines;
      row.mesos = net;
    } else {
      // Nothing to collect. The shares belong to the act that settles what YOU owe, not this one, so
      // no line is carried and Mark paid cannot reach them from here.
      row.owedByYou = -net;
    }
    out.set(person.key, row);
  }

  // Mesos first, because that is the half with a figure on it and the half you can act on today.
  // Pieces break the tie, then the name, so the list never reorders itself between two reads.
  return [...out.values()]
    .filter((row) => row.mesos > 0 || row.pieces > 0)
    .sort((a, b) => b.mesos - a.mesos || b.pieces - a.pieces || a.name.localeCompare(b.name));
}

/**
 * The payout rows that settling this card's SHARES would mark paid.
 *
 * The pieces are not in here and must not be: they have no payout row, so naming one would clear
 * nothing while looking as though it had. That is why coupon debt was kept out of the wallet's own
 * lines, and the same trap is one function away here.
 */
export function sharesOf(row: Collection): { lootId: string; memberId: string }[] {
  return row.lines.map((line) => ({ lootId: line.lootId, memberId: line.payeeId }));
}

/** Nothing of yours is left with them. */
export function isEmpty(row: Collection): boolean {
  return row.pieces === 0 && row.mesos === 0;
}

/**
 * The piles the Sale Ledger still draws: yours, and anyone else's that has rows already recorded.
 *
 * Yours because they are the only ones you can sell out of. Somebody else's ONLY as history: their
 * sales used to be entered tranche by tranche and those rows can be corrected nowhere else, so
 * filtering them away would put a mistyped figure beyond reach. What they owe is not stated there,
 * on the Collection Ledger's side of the split, so the two cannot give two answers.
 *
 * A holder with nothing recorded never gets a card, which is every debt from here on: the list dies
 * out as each old pile is cleared.
 */
export function stillOnSaleLedger<T extends { holder: Holder }>(
  ledgers: T[],
  recorded: (key: string) => boolean,
): { yours: T[]; history: T[] } {
  const yours: T[] = [];
  const history: T[] = [];
  for (const ledger of ledgers) {
    if (ledger.holder.kind === "SELF") yours.push(ledger);
    else if (recorded(holderKey(ledger.holder))) history.push(ledger);
  }
  return { yours, history };
}
