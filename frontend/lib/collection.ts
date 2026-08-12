// What stands between you and each other person, in one place.
//
// Money and pieces, and they are not the same kind of thing.
//
// The MONEY is one net figure, because one transfer of the difference is how a pair actually settles
// and it saves a hop's Auction House fee on the value that no longer crosses. Four things go into it,
// and every one of them is a figure somebody typed or a split of one:
//
//   - shares of a sale, either direction (lib/wallet.ts)
//   - what you sold of THEIR coupons out of your own pile (V56)
//   - what they owe you from anywhere else, entered by hand (V56)
//   - what has actually been paid (V51)
//
// PIECES are not in it and cannot be. Coupons are single-trade, so pieces of yours in somebody else's
// inventory can only be sold by them, and nothing you can see says what they fetched. Those stay a
// count. The one case that DOES have a price is the mirror of it: when you looted the lot, the pieces
// you owe are in your own inventory, so the sale that prices them is one you entered. See V56.
//
// No total is computed here. The shares are lib/wallet.ts's, the pieces and the sale splits are
// lib/vestige-ledger.ts's, and a second copy of any of them would be a second answer.

import { SELF_KEY, holderFromKey, holderKey } from "./vestige-ledger";
import type { Holder, HolderLedger, SaleCredit } from "./vestige-ledger";
import type { Wallet, WalletLine } from "./wallet";
import type { CollectionDebt } from "@/types/vestige";

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
   * Whose pile, for the payment, the entry and the closure this card writes.
   *
   * Rebuilt from the key rather than carried, because a row can now reach this list from four
   * different sources and only some of them have a holder to hand. The two round-trip: see
   * holderFromKey.
   */
  holder: Holder;
  /** Pieces of yours they hold. Deliberately unpriced: only they can sell them. */
  pieces: number;
  /**
   * Mesos they owe you once every direction is netted off. A real figure, unlike the pieces.
   *
   * NET, because one transfer of the difference is how this is actually settled and it saves a hop's
   * Auction House fee on the value that no longer crosses. Zero when the two sides cancel or you are
   * the one behind, and then `owedByYou` carries it instead.
   */
  mesos: number;
  /**
   * Mesos YOU owe them, when the netting comes out that way. Never collectable, said anyway.
   *
   * The ordinary end of looting a boss single-handed: their coupons went out of your inventory, so
   * their half of what the lot fetched is money of theirs you are holding. Settling it is not this
   * ledger's act, but a card that showed only the collectable direction would not mention it at all.
   */
  owedByYou: number;
  /** What the net is made of, in the order the card says them. Every one is signed towards you. */
  parts: {
    /** Unpaid shares, netted. Positive is theirs to send. lib/wallet.ts's figure, untouched. */
    shares: number;
    /** Entered by hand: what they owe you that no drop accounts for. Never negative. See V56. */
    entered: number;
    /** Their coupons you sold out of your own pile, so their money is in your hands. Negative. */
    soldOfTheirs: number;
    /** Your coupons sold out of a pile filed as theirs. Positive, and rare: see saleCredits. */
    soldOfYours: number;
    /**
     * Mesos that have arrived from them, as far as there was a priced debt to put them against.
     *
     * Negative: a payment is a debt going away. Never more than the parts above come to, because a
     * payment cannot make you the debtor. Anything past that is `receivedOnPieces`. See V51.
     */
    received: number;
  };
  /**
   * Mesos received beyond anything priced, which is a payment for the PIECES they are holding.
   *
   * Outside the net and deliberately so. A piece debt has no price, so there is nothing for this to
   * count down; netting it anyway would read as "you owe them 400m" the moment somebody paid you for
   * coupons you cannot value. Stated on its own, which is where it was before V56.
   */
  receivedOnPieces: number;
  /** The entered rows themselves, so a mistyped one can be taken back off the card. */
  entries: CollectionDebt[];
  drops: HeldOfYours[];
  lines: WalletLine[];
};

const blank = (key: string, name: string): Collection => ({
  key,
  name,
  // A PERSON key is somebody who has been named. A CHARACTER key is one nobody has claimed yet, and
  // the same human may be behind two of them, which is said rather than guessed at.
  attributed: key.startsWith("person:"),
  holder: holderFromKey(key),
  pieces: 0,
  mesos: 0,
  owedByYou: 0,
  parts: { shares: 0, entered: 0, soldOfTheirs: 0, soldOfYours: 0, received: 0 },
  receivedOnPieces: 0,
  entries: [],
  drops: [],
  lines: [],
});

/**
 * One row per person who owes you something, from both ledgers at once.
 *
 * Keyed the way both sides already key a counterparty (`person:<id>` or `character:<name>`), so a
 * person who owes you pieces AND a share is one row rather than two.
 */
export function buildCollection(
  ledgers: HolderLedger[],
  wallet: Wallet,
  /** Entered by hand, from V56. Rows rather than a total, so one can be taken back off. */
  debts: CollectionDebt[] = [],
  /** What sales of somebody else's coupons came to, per counterparty. See saleCredits. */
  credits: Map<string, SaleCredit> = new Map(),
  /**
   * Mesos received from each holder, keyed by holderKey.
   *
   * Passed in rather than read off the HolderLedger, which is where it used to come from: a person
   * with no open drop has no ledger at all, so a payment from them was silently worth nothing.
   */
  received: Map<string, number> = new Map(),
  /** What to call a key nothing else on this list can name. Party seats, folded to their people. */
  names: Map<string, string> = new Map(),
): Collection[] {
  const out = new Map<string, Collection>();
  const rowFor = (key: string, name?: string) => {
    const row = out.get(key) ?? blank(key, name ?? names.get(key) ?? key);
    out.set(key, row);
    return row;
  };

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

    const row = rowFor(holderKey(ledger.holder), ledger.holderName);
    row.pieces = ledger.owedToYou;
    row.drops = drops;
  }

  // The shares, NETTED: what they owe you less what you owe them, per person. One transfer of the
  // difference is how this is settled, and it saves the 5% hop on the value that no longer crosses.
  //
  // Mesos against mesos only. Pieces are not netted and cannot be: a piece debt has no price until
  // somebody names one, and the two sides come off different nights at different prices, so calling
  // 50 pieces owed against 25 owed "25 pieces" states a figure that matches neither side.
  for (const person of wallet.counterparties) {
    if (person.lines.length === 0) continue;
    const row = rowFor(person.key, person.name);
    row.parts.shares = person.owed - person.owe;

    // Every line, both directions, because settling the net marks BOTH sides paid. Two sides that
    // cancel still have shares behind them, and the wallet's own settle names all of them.
    //
    // Gated on the SHARE net alone, never on the net below it. Mark paid marks payout rows, and
    // whether those were paid has nothing to do with whose coupons you sold last week: letting the
    // coupon money decide would hide the button on a person whose shares really are outstanding.
    if (row.parts.shares > 0) row.lines = person.lines;
  }

  // Entered by hand, and the only figure on this page nothing else could have known. See V56.
  for (const debt of debts) {
    const row = rowFor(holderKey(debt.holder));
    row.parts.entered += debt.amount;
    row.entries.push(debt);
  }

  // Coupons of somebody else's, sold at a price that was typed. The half of a piece debt that CAN be
  // priced, and the reason `soldOfTheirs` is negative: those pieces left your inventory, so their
  // share of what the lot fetched is money of theirs in your hands.
  for (const [key, credit] of credits) {
    const row = rowFor(key);
    row.parts.soldOfTheirs -= credit.toThem;
    row.parts.soldOfYours += credit.toYou;
  }

  for (const [key, paid] of received) {
    if (key === SELF_KEY || paid === 0) continue;
    rowFor(key).receivedOnPieces += paid;
  }

  for (const row of out.values()) {
    // Everything with a price, before the money that has arrived against it.
    const priced = Object.values(row.parts).reduce((sum, part) => sum + part, 0);
    // A payment pays down what they owe you and stops there. Past that it is not a debt of yours: it
    // is money against the PIECES, which have no price for it to count down. See receivedOnPieces.
    const applied = Math.min(row.receivedOnPieces, Math.max(0, priced));
    // Not `-applied`, which is -0 when nothing was applied and formats as "-0" on the row.
    row.parts.received = applied > 0 ? -applied : 0;
    row.receivedOnPieces -= applied;

    const net = priced - applied;
    row.mesos = Math.max(0, net);
    row.owedByYou = Math.max(0, -net);
  }

  // Mesos first, because that is the half with a figure on it and the half you can act on today.
  // Pieces break the tie, then the name, so the list never reorders itself between two reads.
  //
  // A row you are BEHIND on is kept. It used to be dropped unless pieces held it here, which is
  // exactly the night this ledger now exists to price: you looted the lot, you sold their half, and
  // the only thing outstanding is money of theirs you are sitting on.
  return [...out.values()]
    .filter(
      (row) => row.mesos > 0 || row.owedByYou > 0 || row.pieces > 0 || row.receivedOnPieces > 0,
    )
    .sort(
      (a, b) =>
        b.mesos - a.mesos ||
        b.owedByYou - a.owedByYou ||
        b.pieces - a.pieces ||
        a.name.localeCompare(b.name),
    );
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

/** Nothing stands between you either way. */
export function isEmpty(row: Collection): boolean {
  return row.pieces === 0 && row.mesos === 0 && row.owedByYou === 0;
}

/**
 * The piles the Sale Ledger still draws: yours, and anyone else's that has rows already recorded.
 *
 * Yours because they are the only ones you can sell out of. Somebody else's ONLY as history: their
 * sales used to be entered tranche by tranche and those rows can be corrected nowhere else, so
 * filtering them away would put a mistyped figure beyond reach. What they owe is not stated there,
 * on the Collection Ledger's side of the split, so the two cannot give two answers.
 *
 * A SETTLED pile drops off. A correction affordance is for a transaction somebody may still argue
 * about, and closing the books is the statement that nobody will: what was left was a bare 4.86b on
 * the sale page for a debt paid in full a day earlier, which reads as money outstanding. This is
 * also what makes the section temporary rather than permanent, as it was always meant to be.
 *
 * A holder with nothing recorded never gets a card either, which is every debt from here on.
 */
export function stillOnSaleLedger<T extends { holder: Holder; closed: boolean }>(
  ledgers: T[],
  recorded: (key: string) => boolean,
): { yours: T[]; history: T[] } {
  const yours: T[] = [];
  const history: T[] = [];
  for (const ledger of ledgers) {
    if (ledger.holder.kind === "SELF") yours.push(ledger);
    else if (!ledger.closed && recorded(holderKey(ledger.holder))) history.push(ledger);
  }
  return { yours, history };
}
