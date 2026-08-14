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

import { spendOldestFirst } from "./piece-ledger";
import { SELF_KEY, answeredKey, holderFromKey, holderKey } from "./vestige-ledger";
import type { CouponSale, Holder, HolderLedger, SaleCredit } from "./vestige-ledger";
import type { Wallet, WalletLine } from "./wallet";
import type { ProceedsDisposal, SettlementDebt, SettlementDebtPayout } from "@/types/vestige";

/** One night's coupons sitting in the wrong inventory, in whichever direction it runs. */
export type HeldOfYours = {
  lootId: string;
  partyId: string;
  bossKey: string | null;
  weekStart: string;
  /** The day it fell, which is the order a debt is answered in. See spendOldestFirst. */
  droppedOn: string;
  /**
   * Pieces this person is owed off this night, never the size of the pile holding them.
   *
   * What is STILL owed, not what the night owed to begin with: a sale that answered for 130 coupons
   * has already come off the oldest nights by the time this is read. So these add up to the figure
   * on the card, which the gross ones did not.
   */
  pieces: number;
  /** Which character bent down for them. */
  looterName: string;
  /**
   * True when the pile holding them owes somebody ELSE off the same night.
   *
   * A closure is per (pile, drop), so it cannot say "settled with Bro alone". Closing a shared night
   * would discharge Jared's coupons at the same time and say nothing, which is the silent wrong count
   * this project exists to prevent. Such a night is left open and said as a count instead.
   */
  shared: boolean;
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
  /**
   * Pieces of yours they hold, less any their own priced tranche has already answered for.
   *
   * Deliberately unpriced where it is still a count: only they can sell what is in their inventory.
   * Where they DID sell it and said so, those pieces are money on this card instead, so leaving them
   * here too would ask twice for one debt.
   */
  pieces: number;
  /**
   * Pieces of THEIRS you hold, which is the same debt from the other end.
   *
   * The ordinary night: you loot the lot, so their share sits in your inventory. The card only ever
   * counted the other direction, so a week of runs you were the holder on read as a week with nothing
   * outstanding, and the figure you actually wanted, what comes off their debt, was on no screen.
   *
   * Net of what a sale of yours has already answered for, the same subtraction the Sale Ledger's own
   * card makes. Gross, this said 130 coupons on a night the Sale Ledger said 60, the gap being exactly
   * the 70 sold and priced into `soldOfTheirs` below: one debt, stated twice, in two units.
   */
  piecesYouOwe: number;
  /**
   * Pieces already answered with money, in each direction, and so NOT in the two counts above.
   *
   * Taken off the nights as well, oldest first, so each list adds up to the count over it. The money
   * they became is already on the card, theirs under `already off` or `holding` and yours as a part of
   * the net, so the count is not said again beside the nights: a debt that has been dealt with read as
   * one still outstanding.
   */
  piecesAnswered: { yours: number; theirs: number };
  /**
   * The two above, netted: positive is coupons of theirs you hold, negative is yours they hold.
   *
   * One figure, because one handover settles the pair. Holding 90 of Bro's while he holds 20 of yours
   * is 70 changing hands, not two errands, and the card said "20 pieces · 90 to hand over" and left
   * the subtraction to whoever read it.
   *
   * Netting a COUNT is safe in a way netting a price is not: it is the same coupon on both sides and
   * the same person, so nothing is being valued. That is why the money net and this one are different
   * rules rather than one.
   */
  piecesNet: number;
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
    /**
     * Their coupons you sold, AS FAR AS somebody has said the money comes off what they owe. Negative.
     *
     * Only the OFFSET part of it. Selling Bro's coupons leaves you holding Bro's money, and whether
     * that comes off his debt or gets sent to him is between the two of you. Netting all of it was
     * the app choosing, and it moved a 253.19b debt to 250.78b with nothing on screen to agree to.
     * The rest is `holding`. See V61.
     */
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
  /**
   * Mesos of THEIRS you are holding that nobody has decided about yet. See V61.
   *
   * The money a sale of their coupons realized, before anybody says what happens to it. Outside the
   * net on purpose, because the two things that can happen to it end in different places: it comes
   * off what they owe you, or you send it and their debt does not move. The card used to do the
   * first one silently.
   *
   * Not a debt of yours in `owedByYou` either. That is the netted figure, and putting this in it
   * would be the same automatic offset wearing a different name.
   */
  holding: number;
  /**
   * The sales that money came out of, oldest first. See CouponSale.
   *
   * Carried so a decision about it can name the coupons it was made of: the figure alone said 2.41b
   * came off Bro's debt and nothing said it was 130 coupons over two nights. No figure on the card is
   * derived from these, the money being saleCredits' and the counts the tranches' own.
   */
  sales: CouponSale[];
  /** What has been decided, so a wrong one can be taken back off. See V61. */
  disposals: ProceedsDisposal[];
  /** Drawn whatever it says, because somebody said to keep it. See V59. */
  pinned: boolean;
  /** The entered rows themselves, so a mistyped one can be taken back off the card. */
  entries: SettlementDebt[];
  /** Nights in THEIR pile holding coupons of yours. */
  drops: HeldOfYours[];
  /**
   * Nights in YOUR pile holding coupons of theirs, which is the other half of the same handover.
   *
   * Never on the card before, and that is why closing a pair was impossible: the act only ever named
   * their nights, so a settlement took your side out of the netting and put the figure UP. See
   * settleThePair.
   */
  owedDrops: HeldOfYours[];
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
  piecesYouOwe: 0,
  piecesAnswered: { yours: 0, theirs: 0 },
  piecesNet: 0,
  mesos: 0,
  owedByYou: 0,
  parts: { shares: 0, entered: 0, soldOfTheirs: 0, soldOfYours: 0, received: 0 },
  receivedOnPieces: 0,
  holding: 0,
  sales: [],
  disposals: [],
  pinned: false,
  entries: [],
  drops: [],
  owedDrops: [],
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
  /**
   * Pieces each (pile, creditor) pair has already answered for with money. See answeredByPair.
   *
   * The other half of V56, and the half that never arrived. `credits` above brought the MESOS a
   * priced tranche came to; this brings the PIECES it spoke for. With only the first, a sale of
   * somebody's coupons put its money on this card and left the coupons on it as well.
   */
  answered: Map<string, number> = new Map(),
  /**
   * What has been decided about the money a sale of their coupons left in your hands. See V61.
   *
   * Empty is "nothing decided yet", which is the honest state for every sale before somebody says.
   * It is not the same as "offset", which is what the card assumed for as long as this was missing.
   */
  disposals: ProceedsDisposal[] = [],
): Settlement[] {
  const out = new Map<string, Settlement>();
  const rowFor = (key: string, name?: string) => {
    const row = out.get(key) ?? blank(key, name ?? names.get(key) ?? key);
    out.set(key, row);
    return row;
  };

  // Pieces of theirs in YOUR pile, which is the direction that pays a debt off rather than adding to
  // one. Off your own ledger's transfers, so it is the same subtraction the party rows draw and not a
  // second reading of it. Kept per person, because your pile owes each of them separately.
  for (const ledger of ledgers) {
    if (ledger.holder.kind !== "SELF" || ledger.closed) continue;
    for (const drop of ledger.drops) {
      if (drop.closed) continue;
      const owing = drop.transfers.filter((t) => t.toId !== SELF_KEY);
      for (const transfer of owing) {
        // Named off the transfer, which carries it. A person you only owe coupons to reaches this
        // list nowhere else, so without the name the card was headed `person:<uuid>`.
        const row = rowFor(transfer.toId, transfer.to);
        row.piecesYouOwe += transfer.pieces;
        row.owedDrops.push({
          lootId: drop.lootId,
          partyId: drop.partyId,
          bossKey: drop.bossKey,
          weekStart: drop.weekStart,
          droppedOn: drop.droppedOn,
          pieces: transfer.pieces,
          looterName: drop.looterName,
          // A different PERSON, not merely a second transfer: one night can owe one person twice,
          // and that is still one drop, one closure and nobody else's coupons at stake.
          shared: owing.some((t) => t.toId !== transfer.toId),
        });
      }
    }
  }

  // Off each of those, the pieces a sale of yours already spoke for. Their money is on this card as
  // `soldOfTheirs`, so a coupon left in the count above would be asked for in both units at once.
  //
  // Capped at what is owed, and per person: a tranche naming more than the nights ever owed them is
  // one somebody mistyped, and it must not spill onto the next person's card. See V56.
  for (const [key, row] of out) {
    const paid = answered.get(answeredKey(SELF_KEY, key)) ?? 0;
    row.piecesAnswered.theirs = Math.min(row.piecesYouOwe, paid);
    row.piecesYouOwe -= row.piecesAnswered.theirs;
    // And off the nights themselves, oldest first, so the list adds up to the count above it. It
    // used to be left gross on the reasoning that a tranche names a person and never a boss: true,
    // and what it cost was a panel listing six nights and 180 coupons under a headline of 50, with
    // five of them already sold for. See spendOldestFirst.
    row.owedDrops = spendOldestFirst(row.owedDrops, row.piecesAnswered.theirs);
  }

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
        droppedOn: d.droppedOn,
        pieces: d.transfers
          .filter((t) => t.toId === SELF_KEY)
          .reduce((sum, t) => sum + t.pieces, 0),
        looterName: d.looterName,
        // Their pile owing a third person off the same night. Closing it would call that debt
        // finished as well, and this card has no business saying anything about it.
        shared: d.transfers.some((t) => t.toId !== SELF_KEY),
      }))
      .filter((d) => d.pieces > 0);
    if (drops.length === 0) continue;

    const row = rowFor(holderKey(ledger.holder), ledger.holderName);
    // The mirror of the subtraction above: coupons of yours THEY sold out of their own pile and said
    // were yours. `soldOfYours` carries what those fetched, so the count stops here too.
    const paid = answered.get(answeredKey(holderKey(ledger.holder), SELF_KEY)) ?? 0;
    row.piecesAnswered.yours = Math.min(ledger.owedToYou, paid);
    row.pieces = ledger.owedToYou - row.piecesAnswered.yours;
    // The same subtraction as the other direction, over the same nights, so neither list can state a
    // total the card contradicts.
    row.drops = spendOldestFirst(drops, row.piecesAnswered.yours);
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
  // priced: those pieces left your inventory, so their share of what the lot fetched is money of
  // theirs in your hands.
  //
  // It lands in `holding` and NOT in the net. Which of the two things happens to it is the pair's
  // decision: it comes off what they owe you, or you send it and their debt does not move. Netting it
  // on arrival took Bro's 253.19b to 250.78b with nothing on screen to agree to. See V61.
  for (const [key, credit] of credits) {
    const row = rowFor(key);
    row.holding += credit.toThem;
    row.sales.push(...credit.sales);
    row.parts.soldOfYours += credit.toYou;
  }

  // What has been decided about it. An OFFSET is the netting, now chosen rather than assumed, so it
  // moves out of `holding` and into the net. A payment out leaves both: the money went to them and
  // their debt to you never moved.
  //
  // Capped at what you are holding, and the excess is said rather than absorbed: deciding about money
  // you do not have is a miscount, and a card that quietly clamped it would hide the typo. Same rule
  // as the pieces, and the same reason the server does not refuse it.
  for (const disposal of disposals) {
    const row = rowFor(holderKey(disposal.holder));
    row.disposals.push(disposal);
    const spent = Math.min(row.holding, disposal.amount);
    row.holding -= spent;
    if (disposal.kind === "OFFSET") row.parts.soldOfTheirs -= spent;
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

  // Both directions are in by now, so the pair becomes the one figure that changes hands.
  for (const row of out.values()) {
    // The sides cancel BEFORE either is listed. The header was already the net, one handover settling
    // the pair, and leaving the lists gross made them contradict it: 50 coupons of Bro's in your pile
    // over 20 of yours in his read as 70 outstanding under a headline of 30, and the 20 on each side
    // was a night nobody has to do anything about.
    //
    // Netting a COUNT is safe where netting a price would not be: same coupon, same person, nothing
    // valued. It is the rule the header already runs on, applied one level down.
    const wash = Math.min(row.pieces, row.piecesYouOwe);
    row.pieces -= wash;
    row.piecesYouOwe -= wash;
    // Oldest first, the way a sale is spent, and the cancelled nights stay in the array at zero:
    // settleThePair closes them, and a wash finishes both sides of one. PieceNights draws none.
    row.drops = spendOldestFirst(row.drops, wash);
    row.owedDrops = spendOldestFirst(row.owedDrops, wash);
    row.piecesNet = row.piecesYouOwe - row.pieces;
  }

  return [...out.values()]
    .filter(
      (row) =>
        row.pinned ||
        row.mesos > 0 ||
        row.owedByYou > 0 ||
        row.pieces > 0 ||
        // Coupons of theirs you are holding are exactly the thing this ledger is for now: they come
        // off what that person owes you. A card kept only for the other direction hid them.
        row.piecesYouOwe > 0 ||
        row.receivedOnPieces > 0 ||
        // Money of theirs you are sitting on with nothing decided about it. The one thing on this
        // card somebody still has to act on, so a card dropped for lack of a net would be the act
        // going missing along with it.
        row.holding > 0,
    )
    .sort(
      (a, b) =>
        b.mesos - a.mesos ||
        b.owedByYou - a.owedByYou ||
        b.pieces - a.pieces ||
        b.piecesYouOwe - a.piecesYouOwe ||
        a.name.localeCompare(b.name),
    );
}

/**
 * The purchases somebody else's pile has recorded against YOUR coupons, per holder.
 *
 * Entered on their card and correctable only there. The Sale Ledger draws your own piles alone, so a
 * tranche written against theirs has a pill on no screen otherwise, and a mistyped one re-prices the
 * card it is on with no way to take it off. That is the state the pieces themselves were in.
 *
 * Keyed by holderKey, the way the card looks everything else up.
 */
export function keptOfYours<T extends { holder: Holder; shares?: { holder: Holder }[] }>(
  tranches: T[],
): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const tranche of tranches) {
    const pile = holderKey(tranche.holder);
    if (pile === SELF_KEY) continue;
    if (!(tranche.shares ?? []).some((s) => holderKey(s.holder) === SELF_KEY)) continue;
    const seen = out.get(pile);
    if (seen) seen.push(tranche);
    else out.set(pile, [tranche]);
  }
  return out;
}

/** One act that has already come off what they owe you. See V57, V58 and V61. */
export type Discharge = {
  id: string;
  /**
   * Which ledger it lives in, because taking it back goes to a different place.
   *
   * DEBT is an entry with a negative amount: the shares offset writes one, and so does anybody
   * typing a credit by hand. PROCEEDS is a decision about their money you were holding.
   */
  source: "DEBT" | "PROCEEDS";
  /** Mesos it took off. POSITIVE, so a list of them adds up to what has come off. */
  amount: number;
  label: string;
  at: string;
  /** The shares it discharged, where it names any. Empty on a typed credit and on a disposal. */
  payouts: SettlementDebtPayout[];
  /**
   * The coupon sales it was made of. Empty on everything but a decision, and on a decision whose
   * sales cannot be told: see couponSalesBehind.
   */
  sales: CouponSale[];
};

/**
 * Which coupon sales each decision about their money was made of.
 *
 * A decision names no tranche. It is taken on the whole undecided pile at once, so which sales that
 * was is worked out by spending them in the same order buildSettlement spends the money: both lists
 * arrive oldest first, and each decision takes off the front of what is left.
 *
 * WHOLE SALES, and the run has to land exactly on the amount. Part of a sale cannot say which coupons
 * it was, and a row reading "70 coupons" beside 400m of a 1.3b sale is a wrong number wearing an
 * itemisation. Where the alignment goes, that decision and every later one get nothing, and their rows
 * say what they said before: a figure, and no claim about its parts.
 */
function couponSalesBehind(
  sales: CouponSale[],
  disposals: ProceedsDisposal[],
): Map<string, CouponSale[]> {
  const out = new Map<string, CouponSale[]>();
  let next = 0;
  for (const disposal of disposals) {
    const taken: CouponSale[] = [];
    let sum = 0;
    while (sum < disposal.amount && next < sales.length) {
      const sale = sales[next]!;
      sum += sale.mesos;
      taken.push(sale);
      next += 1;
    }
    if (sum !== disposal.amount) break;
    out.set(disposal.id, taken);
  }
  return out;
}

/**
 * The money rows split by what they ARE: what builds the debt, and what has come off it.
 *
 * One list mixed the two, so an offset read as a debt and only a chevron told them apart, and every
 * press of Offset added a row that never left. Three acts against one person were three lines saying
 * the same kind of thing, interleaved with the one line that said what he actually owed.
 *
 * They are different questions. What is owed is a standing fact; what came off it is a history of
 * acts, each with a date and each removable. So the card asks them separately and folds the history,
 * which is the half that grows without bound.
 *
 * A DISCHARGE is anything with a negative sign or a share behind it. Classifying on the sign as well
 * as on the payouts catches a credit typed by hand, which V57 allows and which would otherwise sit in
 * the owed list reading as a debt of minus a billion.
 */
export function moneyRows(row: Settlement): {
  /** Debts somebody typed, in the order they were entered. */
  typed: SettlementDebt[];
  /** Every act that came off, newest first: the half worth folding is the half that grows. */
  discharges: Discharge[];
  /** What those acts come to. Positive. */
  discharged: number;
} {
  const typed: SettlementDebt[] = [];
  const discharges: Discharge[] = [];

  for (const entry of row.entries) {
    if (entry.payouts.length === 0 && entry.amount >= 0) {
      typed.push(entry);
      continue;
    }
    discharges.push({
      id: entry.id,
      source: "DEBT",
      amount: Math.abs(entry.amount),
      label: entry.note ?? "offset",
      at: entry.incurredAt,
      payouts: entry.payouts,
      sales: [],
    });
  }

  // Only the decisions that took something off get a ROW, but every one of them spent money you were
  // holding, so the matching has to see the lot. Handed the offsets alone it would give the second one
  // the sales the first payment out had already used up.
  const behind = couponSalesBehind(row.sales, row.disposals);

  // Only the decisions that took something off. Paying them out discharged money of THEIRS in your
  // hands and left what they owe you exactly where it was, so it belongs where that money is said.
  for (const disposal of row.disposals) {
    if (disposal.kind !== "OFFSET") continue;
    discharges.push({
      id: disposal.id,
      source: "PROCEEDS",
      amount: disposal.amount,
      label: "coupon sale",
      at: disposal.decidedAt,
      payouts: [],
      sales: behind.get(disposal.id) ?? [],
    });
  }

  discharges.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
  return {
    typed,
    discharges,
    discharged: discharges.reduce((sum, d) => sum + d.amount, 0),
  };
}

/** What closing the coupon books with one person would cover, in nights. See settleThePair. */
export type PairSettlement = {
  /** Nights in their pile it closes: coupons of yours they were holding. */
  theirs: string[];
  /** Nights in your own pile it closes: coupons of theirs you were holding. */
  yours: string[];
  /** Nights left open because the same night owes somebody else. A count, said on the card. */
  shared: number;
  /** Bosses the act finishes, both sides together. What the button says before it runs. */
  bosses: number;
  offered: boolean;
};

/**
 * The nights one handover between you and this person finishes, in BOTH directions.
 *
 * A coupon relationship is settled by one transfer of the difference, the same way the money is. The
 * act only ever named their side, so it could not say that: closing their nights alone took your own
 * coupons out of the netting and put the figure UP, and a card reading "60 to hand over" answered a
 * click by asking for 80. That is the trap the Settle button already carries a comment about, one
 * step along, and the fix is the same one. Close the pair or close nothing.
 *
 * A night that owes a THIRD person is left out and counted instead. A closure is keyed (pile, drop),
 * so it cannot mean "settled with Bro alone", and closing one would call Jared's coupons settled
 * without a word on any screen. Prefer a missing item over a wrong count.
 */
export function settleThePair(row: Settlement): PairSettlement {
  const theirs = row.drops.filter((d) => !d.shared);
  // One night can owe them twice, off two transfers, and it is one drop and one closure.
  const yours = [...new Set(row.owedDrops.filter((d) => !d.shared).map((d) => d.lootId))];
  const shared =
    row.drops.filter((d) => d.shared).length +
    new Set(row.owedDrops.filter((d) => d.shared).map((d) => d.lootId)).size;
  const lootIds = theirs.map((d) => d.lootId);
  return {
    theirs: lootIds,
    yours,
    shared,
    bosses: lootIds.length + yours.length,
    offered: lootIds.length + yours.length > 0,
  };
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
  /** Its art, so the row is read the way every other drop row on this account is. */
  iconUrl: string | null;
  boss: string;
  /**
   * Who was in that night, not who the share belonged to.
   *
   * The payee is whoever this card is about, so naming them on their own card said nothing. Who ELSE
   * was there is the fact that places the night, and it is the same list the drop's own row carries.
   */
  members: string[];
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
  return row.pieces === 0 && row.piecesYouOwe === 0 && row.mesos === 0 && row.owedByYou === 0;
}

/**
 * The piles the Sale Ledger draws, which is yours: the only ones you can sell out of.
 *
 * Somebody else's used to stay as history, because their sales were once entered here tranche by
 * tranche and those rows could be corrected nowhere else. That entry shape is gone and so are the
 * rows, so the card that held them is gone too. What they owe is the Settlement Ledger's to say, and
 * only its, so the two cannot give two answers.
 */
export function yourPiles<T extends { holder: Holder }>(ledgers: T[]): T[] {
  return ledgers.filter((ledger) => ledger.holder.kind === "SELF");
}
