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
import type { SettlementDebt } from "@/types/vestige";

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
export type Settlement = {
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
    /**
     * Entered by hand. Positive is what they owe you that no drop accounts for.
     *
     * SIGNED since V57: a negative is a share of YOURS discharged against theirs, which is how a
     * lopsided pair actually settles. Marking that share paid alone said the money had moved.
     */
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
  /** Drawn whatever it says, because somebody said to keep it. See V59. */
  pinned: boolean;
  /** The entered rows themselves, so a mistyped one can be taken back off the card. */
  entries: SettlementDebt[];
  drops: HeldOfYours[];
  lines: WalletLine[];
};

const blank = (key: string, name: string): Settlement => ({
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
  pinned: false,
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
export function buildSettlement(
  ledgers: HolderLedger[],
  wallet: Wallet,
  /** Entered by hand, from V56. Rows rather than a total, so one can be taken back off. */
  debts: SettlementDebt[] = [],
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
  /**
   * People whose card is drawn whatever it says. See V59.
   *
   * A card appearing only when something is outstanding is right for a debt settled once, and wrong
   * for the three people you run every boss with: the place you enter what they owe is somewhere you
   * would have to make appear first.
   */
  pinned: Set<string> = new Set(),
): Settlement[] {
  const out = new Map<string, Settlement>();
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

    // Every line, both directions, and in EVERY direction the net runs.
    //
    // It used to be carried only when the net ran towards you, on the reasoning that settling what
    // YOU owe is a different act and did not belong on a card about collecting. That reasoning went
    // when this card started netting both ways, and deleting the Wallet took the only other place it
    // could be done: four shares Jonathan owed had no settle anywhere in the app. A relationship is
    // settled by ONE transfer of the difference, which marks both sides paid at once, so the lines
    // that transfer covers are all of them.
    row.lines = person.lines;
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
  // A pinned person gets a row even with nothing on it, which is the one case a blank card is
  // wanted: it is where next week's entry goes.
  for (const key of pinned) rowFor(key).pinned = true;

  return [...out.values()]
    .filter(
      (row) =>
        row.pinned ||
        row.mesos > 0 ||
        row.owedByYou > 0 ||
        row.pieces > 0 ||
        row.receivedOnPieces > 0,
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
export function sharesOf(row: Settlement): { lootId: string; memberId: string }[] {
  return row.lines.map((line) => ({ lootId: line.lootId, memberId: line.payeeId }));
}

/**
 * One share an offset discharged, resolved for the card.
 *
 * Built from the pools rather than looked up on the card, because a share that has been offset is
 * PAID and has left the wallet: that is the whole reason V58 stores which ones they were.
 */
export type OffsetShare = {
  key: string;
  /** What fell. Leads the row: the boss alone says which night, never which thing. */
  item: string;
  boss: string;
  who: string;
  /** The day it dropped, so two nights on one boss are told apart. */
  on: string;
  /** This seat's share, which is the money the offset actually discharged. */
  share: number;
  /** What the whole lot sold for, so the share can be checked against it. Null if never sold. */
  sale: number | null;
  partyId: string;
};

/** How a resolved share is keyed. One drop owes several people, so both halves are needed. */
export function shareKey(lootId: string, memberId: string): string {
  return `${lootId}:${memberId}`;
}

/** What the whole list comes to, in the three figures the Wallet page used to carry. */
export type SettlementTotals = { owed: number; owe: number; net: number; people: number };

/**
 * The account's position, summed off the CARDS rather than worked out again.
 *
 * The Wallet had its own pass over the pools for this, which is how two surfaces get two answers.
 * These are the same rows the list below draws, so a tile that disagrees with the cards under it is
 * arithmetically impossible rather than merely unlikely.
 *
 * The pieces are not in it. A count cannot be added to a total of mesos, which is the rule the whole
 * ledger is built on.
 */
export function settlementTotals(rows: Settlement[]): SettlementTotals {
  const owed = rows.reduce((sum, row) => sum + row.mesos, 0);
  const owe = rows.reduce((sum, row) => sum + row.owedByYou, 0);
  return { owed, owe, net: owed - owe, people: rows.length };
}

/**
 * The payout rows for the shares YOU owe, which is what "Mark sent" and "Offset" both act on.
 *
 * Not sharesOf, which is every line: on a card running both ways that would mark what THEY owe you
 * paid at the same time, and say you had collected money nobody has sent.
 */
export function owedByYouShares(row: Settlement): { lootId: string; memberId: string }[] {
  return row.lines
    .filter((line) => line.direction === "owe")
    .map((line) => ({ lootId: line.lootId, memberId: line.payeeId }));
}

/** What discharging the shares you owe against what they owe you would come to. See V57. */
export type Offset = {
  /** Mesos of shares it discharges, which is all of them or none. */
  amount: number;
  /**
   * What it has to come off: everything on their side EXCEPT the shares it discharges.
   *
   * `mesos` cannot answer this. It is the net, so the shares you owe are already subtracted from it,
   * and the moment they outgrew the debt it read zero and the act was refused on the very card it was
   * for. Adding them back gives what they owe you before the offset is applied.
   */
  toComeOff: number;
  /** What their debt cannot cover, and so leaves you owing. Zero when it covers the lot. */
  leftOwing: number;
  /**
   * Whether the act is offered.
   *
   * Needs shares of yours, and a debt of theirs to come off, but NOT one big enough to swallow the
   * whole thing: taking a week of coupons off a smaller debt clears it and leaves you owing the rest,
   * which is an ordinary night. Offsetting against nothing is still not an offset, it is just a debt
   * of yours, and this ledger has no act for paying one.
   */
  offered: boolean;
};

/**
 * What an offset would do to this card, in the figures the button has to say before it runs.
 *
 * The whole act discharges whole shares, so the amount is every share you owe or none: a payout row
 * is paid or it is not, and there is no half of one to record. Where the debt cannot cover them the
 * remainder stays yours in mesos, which the net was already saying and the button now says too.
 */
export function offsetOf(row: Settlement): Offset {
  const amount = row.lines
    .filter((line) => line.direction === "owe")
    .reduce((sum, line) => sum + line.pay, 0);
  const toComeOff = row.mesos - row.owedByYou + amount;
  return {
    amount,
    toComeOff,
    leftOwing: Math.max(0, amount - toComeOff),
    offered: amount > 0 && toComeOff > 0,
  };
}

/** Nothing stands between you either way. */
export function isEmpty(row: Settlement): boolean {
  return row.pieces === 0 && row.mesos === 0 && row.owedByYou === 0;
}

/**
 * The piles the Sale Ledger still draws: yours, and anyone else's that has rows already recorded.
 *
 * Yours because they are the only ones you can sell out of. Somebody else's ONLY as history: their
 * sales used to be entered tranche by tranche and those rows can be corrected nowhere else, so
 * filtering them away would put a mistyped figure beyond reach. What they owe is not stated there,
 * on the Settlement Ledger's side of the split, so the two cannot give two answers.
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
