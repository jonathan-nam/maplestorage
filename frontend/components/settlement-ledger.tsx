"use client";

import Link from "next/link";
import { useState } from "react";
import { formatWeekStart } from "@/lib/boss-clears";
import { bossLabel } from "@/lib/boss-difficulty";
import {
  type Discharge,
  type HeldOfYours,
  type Settlement,
  type OffsetShare,
  moneyRows,
  offsetOf,
  owedByYouShares,
  settleThePair,
  shareKey,
  sharesOf,
} from "@/lib/settlement";
import { apiAssetUrl } from "@/lib/api";
import { CopyAmount } from "@/components/copy-amount";
import { formatMesos, parseMesos } from "@/lib/drop-split";
import { formatDropped } from "@/lib/loot";
import type { Holder } from "@/lib/vestige-ledger";
import type { Boss } from "@/types/boss";
import type { Party } from "@/types/party";
import type { SettlementDebt, VestigePayment, VestigeTranche } from "@/types/vestige";

// One card per person, in the two units something can stand between you.
//
// MONEY is one net figure, made of every part that has a price: shares of a sale, coupons of theirs
// you sold out of your own pile, what they owe you from elsewhere, and what has been paid. The parts
// are listed because a net nobody can take apart is a net nobody can check.
//
// PIECES are the other unit and stay a count. Coupons are single-trade, so pieces of yours in
// somebody else's inventory can only be sold by them, and what they fetched is not something this can
// see. The mirror case, where you looted the lot, is priced by the sale you entered: see V56.
//
// Nothing here computes a meso. Every number comes off lib/settlement.ts.

// COLOUR ONLY WHERE "DONE OR NOT" IS A REAL QUESTION, which is the headline and the money that has
// arrived. Red for outstanding, green for paid, green matching .loot-paid.is-paid on a share badge
// so one app cannot have it mean settled on one page and outstanding on the next.
//
// The parts under a card are ARITHMETIC: components that sum to the headline. "Settled" cannot be
// asked of one. Colouring them anyway put a figure like -139,548,023 in red for being unsettled
// while it was also a credit AGAINST the debt above it, so the same number read as a problem and as
// progress at once. The sign carries them instead, and every one of them is signed.

export function SettlementLedger({
  rows,
  bossByKey,
  partyById,
  offsetShares,
  iconUrl,
  busy,
  payments,
  onAddPayment,
  onRemovePayment,
  onAddDebt,
  onRemoveDebt,
  keptRows,
  onDisposeProceeds,
  onRemoveDisposal,
  onKeepPieces,
  onRemoveKeep,
  onSettlePair,
  onSettleShares,
  onPin,
  onOffsetShares,
}: {
  rows: Settlement[];
  bossByKey: Map<string, Boss>;
  partyById: Map<string, Party>;
  /** The shares an offset discharged, resolved, keyed by shareKey(). See V58. */
  offsetShares: Map<string, OffsetShare>;
  /** The coupon's own sprite, for the acts whose every piece is one. See DischargeRow. */
  iconUrl: string | null;
  busy: boolean;
  /** What each person has paid, keyed by holderKey(), so a mistyped one can be taken back. */
  payments: Map<string, VestigePayment[]>;
  onAddPayment: (holder: Holder, amount: number) => Promise<void>;
  onRemovePayment: (paymentId: string) => Promise<void>;
  onAddDebt: (holder: Holder, amount: number, note: string) => Promise<void>;
  onRemoveDebt: (debtId: string) => Promise<void>;
  /** Purchases each person's pile has recorded against your coupons. See keptOfYours. */
  keptRows: Map<string, VestigeTranche[]>;
  /**
   * Says what becomes of their money you are holding: off their debt, or sent to them. See V61.
   *
   * The card cannot choose, so it asks. Netting it on arrival was the app deciding something only
   * the two of you can.
   */
  onDisposeProceeds: (holder: Holder, amount: number, kind: "OFFSET" | "PAID") => Promise<void>;
  /** Taking a decision back off, which nothing else on any screen can do. */
  onRemoveDisposal: (disposalId: string) => Promise<void>;
  /**
   * Records that they are keeping the coupons of yours they hold, at a price the two of you agreed.
   *
   * A purchase against THEIR pile naming you, which is V50's act read from the other end. The one
   * offset the netting is not entitled to make on its own.
   */
  onKeepPieces: (holder: Holder, pieces: number, amount: number) => Promise<void>;
  /** Taking one of those back off, which nothing else on any screen can do. */
  onRemoveKeep: (trancheId: string) => Promise<void>;
  /** Closes the coupon books with this person, BOTH sides at once. See settleThePair. */
  onSettlePair: (holder: Holder, theirs: string[], yours: string[]) => Promise<void>;
  onSettleShares: (payouts: { lootId: string; memberId: string }[]) => Promise<void>;
  /** Keeps this person's card drawn with nothing outstanding, or stops. See V59. */
  onPin: (row: Settlement, pinned: boolean) => Promise<void>;
  /** Marks the shares paid AND records the offset, so the net does not move. See V57. */
  onOffsetShares: (
    holder: Holder,
    amount: number,
    name: string,
    payouts: { lootId: string; memberId: string }[],
  ) => Promise<void>;
}) {
  if (rows.length === 0) return null;
  return (
    <>
      {rows.map((row) => (
        <SettlementCard
          key={row.key}
          row={row}
          bossByKey={bossByKey}
          partyById={partyById}
          offsetShares={offsetShares}
          iconUrl={iconUrl}
          busy={busy}
          payments={payments.get(row.key) ?? []}
          onAddPayment={onAddPayment}
          onRemovePayment={onRemovePayment}
          onAddDebt={onAddDebt}
          onRemoveDebt={onRemoveDebt}
          keptRows={keptRows.get(row.key) ?? []}
          onDisposeProceeds={onDisposeProceeds}
          onRemoveDisposal={onRemoveDisposal}
          onKeepPieces={onKeepPieces}
          onRemoveKeep={onRemoveKeep}
          onSettlePair={onSettlePair}
          onSettleShares={onSettleShares}
          onPin={onPin}
          onOffsetShares={onOffsetShares}
        />
      ))}
    </>
  );
}

function SettlementCard({
  row,
  bossByKey,
  partyById,
  offsetShares,
  iconUrl,
  busy,
  payments,
  onAddPayment,
  onRemovePayment,
  onAddDebt,
  onRemoveDebt,
  keptRows,
  onDisposeProceeds,
  onRemoveDisposal,
  onKeepPieces,
  onRemoveKeep,
  onSettlePair,
  onSettleShares,
  onPin,
  onOffsetShares,
}: {
  row: Settlement;
  bossByKey: Map<string, Boss>;
  partyById: Map<string, Party>;
  /** The shares an offset discharged, resolved, keyed by shareKey(). See V58. */
  offsetShares: Map<string, OffsetShare>;
  /** The coupon's own sprite, for the acts whose every piece is one. See DischargeRow. */
  iconUrl: string | null;
  busy: boolean;
  /** This person's payments, so a mistyped one can be taken back. */
  payments: VestigePayment[];
  onAddPayment: (holder: Holder, amount: number) => Promise<void>;
  onRemovePayment: (paymentId: string) => Promise<void>;
  onAddDebt: (holder: Holder, amount: number, note: string) => Promise<void>;
  onRemoveDebt: (debtId: string) => Promise<void>;
  /** This person's pile's purchases of your coupons, so a mistyped one can be taken back. */
  keptRows: VestigeTranche[];
  /**
   * Says what becomes of their money you are holding: off their debt, or sent to them. See V61.
   *
   * The card cannot choose, so it asks. Netting it on arrival was the app deciding something only
   * the two of you can.
   */
  onDisposeProceeds: (holder: Holder, amount: number, kind: "OFFSET" | "PAID") => Promise<void>;
  /** Taking a decision back off, which nothing else on any screen can do. */
  onRemoveDisposal: (disposalId: string) => Promise<void>;
  /**
   * Records that they are keeping the coupons of yours they hold, at a price the two of you agreed.
   *
   * A purchase against THEIR pile naming you, which is V50's act read from the other end. The one
   * offset the netting is not entitled to make on its own.
   */
  onKeepPieces: (holder: Holder, pieces: number, amount: number) => Promise<void>;
  /** Taking one of those back off, which nothing else on any screen can do. */
  onRemoveKeep: (trancheId: string) => Promise<void>;
  /** Closes the coupon books with this person, BOTH sides at once. See settleThePair. */
  onSettlePair: (holder: Holder, theirs: string[], yours: string[]) => Promise<void>;
  onSettleShares: (payouts: { lootId: string; memberId: string }[]) => Promise<void>;
  /** Keeps this person's card drawn with nothing outstanding, or stops. See V59. */
  onPin: (row: Settlement, pinned: boolean) => Promise<void>;
  /** Marks the shares paid AND records the offset, so the net does not move. See V57. */
  onOffsetShares: (
    holder: Holder,
    amount: number,
    name: string,
    payouts: { lootId: string; memberId: string }[],
  ) => Promise<void>;
}) {
  const [got, setGot] = useState("");
  const [owed, setOwed] = useState("");
  const [kept, setKept] = useState("");
  // Whether the history of what has come off is open. Folded by default: it is the half that grows.
  const [showOff, setShowOff] = useState(false);
  const [note, setNote] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);

  const payment = parseMesos(got);
  const paid = payment !== null && payment >= 1 ? payment : null;
  const entered = parseMesos(owed);
  const owing = entered !== null && entered >= 1 ? entered : null;
  // What they are paying to keep the coupons of yours they hold. Above zero, matching the server: a
  // stack handed over for nothing is not a purchase at a price of nought, it is a handover.
  const keeping = parseMesos(kept);
  const keeps = keeping !== null && keeping >= 1 ? keeping : null;

  /**
   * A part's label, led by the pieces it answered for where it answered for any.
   *
   * The count is what the headline above stopped asking for, so it belongs on the row that took it
   * away. Absent on the rows that carry no count: a leading zero would read as a debt of nothing.
   */
  const countedLabel = (pieces: number, label: string) =>
    pieces > 0 ? `${pieces} ${label}` : label;

  async function write(action: Promise<void>, clear: null | (() => void)) {
    setRefusal(null);
    try {
      await action;
      clear?.();
    } catch (e) {
      setRefusal(e instanceof Error ? e.message : "That didn't save.");
    }
  }

  // Each half only when there is one. The mesos are netted, so it is one figure in one direction
  // rather than a column of both.
  //
  // To the MESO, not shortened. A settled 144m share moved this card from 253.86b to 254b, which at
  // two decimals is a figure that did not appear to move at all: the parts below have always been
  // exact, so rounding only their sum made the one number you act on the one number you cannot
  // check. This is a debt somebody is going to be asked for, and the pieces beside it are a count.
  // The one figure on the card anybody pastes anywhere, whichever way it runs. Null when the two
  // sides cancel and only the pieces hold the card here.
  const toCopy = row.mesos > 0 ? row.mesos : row.owedByYou > 0 ? row.owedByYou : null;

  /**
   * The drops behind the shares figure, on hover.
   *
   * They are already listed further down the card, under their own step, but two forms sit between
   * the two: the number and the nights it came off do not read as the same thing from that far
   * apart. Signed the way the list is, so a night you owe for is told from one you are owed for.
   */
  const behindShares = row.lines
    .map((line) => {
      const boss = bossByKey.get(line.bossKey ?? "");
      const party = partyById.get(line.partyId);
      const where = boss ? bossLabel(boss.name, party?.difficulty ?? null) : "Unknown boss";
      const mesos = formatMesos(line.direction === "owe" ? -line.nets : line.nets, true);
      return `${line.name} \u00b7 ${where} \u00b7 ${line.theirs}: ${mesos}`;
    })
    .join("\n");

  /** A component of the net, always signed: nothing else on the row says which way it pushes. */
  const signed = (mesos: number) => `${mesos > 0 ? "+" : ""}${formatMesos(mesos, true)}`;

  // What the net is made of, in the order the money moved. Only the parts that happened: a zero says
  // nothing and four of them would bury the one that matters.
  const parts = [
    {
      key: "shares",
      label: "shares",
      mesos: row.parts.shares,
      detail: behindShares,
    },
    // `soldOfTheirs` is NOT here, and must not be. It is only ever the part of their money somebody
    // has said comes off their debt, which makes it a discharge, and discharges are listed once
    // under `already off`. It was in both lists at once: 2,412,222,150 read as a row of the owed
    // list and again inside the fold below it, so the two lists came to more than the card did.
    {
      key: "theirs",
      label: countedLabel(row.piecesAnswered.yours, `coupons of mine ${row.name} sold`),
      mesos: row.parts.soldOfYours,
    },
    // Money that has ARRIVED. Not owing and not owed: it is the one part that is finished, so it
    // reads as neither, and a ledger where the settled money is the same colour as the outstanding
    // money is a ledger you have to read twice.
    { key: "received", label: "received", mesos: row.parts.received, paid: true },
  ].filter((part) => part.mesos !== 0);

  /**
   * Discharging what you owe against what they owe you, and what that leaves. See offsetOf.
   *
   * The settlement two people actually make when the sums are lopsided: rather than send somebody
   * 139,548,023 and have them send 254b back, it comes off the larger figure. Marking the share paid
   * alone said the money had moved, which took it out of the netting and put what they owe you back
   * UP, and that is the opposite of what happened. See V57.
   */
  // What builds the debt, and what has already come off it. Two questions, so two lists: see
  // moneyRows for why one list could not hold both.
  const { typed, discharges, discharged } = moneyRows(row);
  // Money you SENT them, which took nothing off what they owe you and so is not in `discharges`.
  const paidOut = row.disposals.filter((d) => d.kind === "PAID");

  // The nights one handover finishes, both sides. Offered whenever either side has one: a debt that
  // runs only one way is still a pair, with nothing on the other end.
  const pair = settleThePair(row);

  const offset = offsetOf(row);
  // Mesos a settle would declare you have ALREADY sent. Off the offset, rather than summed again
  // here: two spellings of one figure is how the button and its label come to disagree.
  const owes = offset.amount;
  /**
   * Whether there is anything here to COLLECT, which is what decides the button exists.
   *
   * A card whose every share runs against you has nothing to collect, so a Settle on it can only
   * ever mean "I have already paid them", which is the one thing nobody comes to this page to say.
   * Jonathan clicked it three times expecting the opposite and each time it took his own debt out of
   * the netting and put the figure back UP. A warning beside it was not enough, and could not be: a
   * button with one possible effect, and that effect wrong, is a trap however it is labelled.
   *
   * Where any line DOES run towards you the button stays, and it still settles both directions at
   * once, because a relationship is settled by one transfer of the difference.
   *
   * Nothing is stranded by this. A share you owe is marked paid on the party page, share by share,
   * next to the drop it came off.
   */
  const collectable = row.lines.some((line) => line.direction === "owed");
  /**
   * Whether there is a share of YOURS here to mark as actually paid.
   *
   * Distinct from Settle, which collects, and from Offset, which discharges one against a debt of
   * theirs. This is the third thing that can happen to a share you owe: you sent them the mesos.
   *
   * It went missing when Settle was pulled off a card with nothing to collect, and pulling it was
   * right; what was wrong was leaving no act in its place. Jared's card said "you owe 289,382,716"
   * with nothing to do about it, which is a ledger you cannot keep.
   */
  const sendable = owes > 0;

  /**
   * The nights one act discharged, named. Off the pools rather than the wallet's lines: the settle
   * that made an offset marked those shares PAID, so they have left the wallet by the time this row
   * is drawn. That is the whole reason V58 stores them.
   */
  const nightsBehind = (payouts: { lootId: string; memberId: string }[]): OffsetShare[] =>
    payouts.map(
      (share) =>
        offsetShares.get(shareKey(share.lootId, share.memberId)) ?? {
          // The drop has been deleted since. Said rather than left out: a row that quietly drops one
          // of the nights behind a figure is a figure that no longer adds up.
          key: shareKey(share.lootId, share.memberId),
          item: "A drop that has been deleted",
          iconUrl: null,
          boss: "",
          members: [],
          on: "",
          share: 0,
          sale: null,
          partyId: "",
        },
    );

  return (
    <section className="ledger-card">
      <header className="ledger-head">
        {/* Kept whatever it says. Only a PERSON can be pinned: a character nobody has claimed is
            somebody the account cannot name yet, and pinning one would keep a card for a human it
            may turn out to already have. */}
        {row.attributed && (
          <button
            type="button"
            className={row.pinned ? "ledger-pin is-pinned" : "ledger-pin"}
            disabled={busy}
            onClick={() => void write(onPin(row, !row.pinned), null)}
            aria-label={row.pinned ? `Stop keeping ${row.name}'s card` : `Keep ${row.name}'s card`}
            title={row.pinned ? "Kept. Click to stop." : "Keep this card when nothing is owed"}
          >
            {row.pinned ? "★" : "☆"}
          </button>
        )}
        <span className="loot-title">
          <span className="loot-name">{row.name}</span>
          {/* The direction the whole card runs, coloured as the parts below it are, so the headline
              and its own arithmetic never read as two different kinds of thing.

              The money is copyable: it is the figure that gets pasted into the game's trade box, and
              retiring the Wallet took the only place on this account where that was possible. The
              pieces are not, being a count of coupons rather than a price. */}
          <span className={"loot-meta ledger-summary is-open"}>
            {/* ONE count, netted, because one handover settles the pair: holding 90 of theirs
                while they hold 20 of yours is 70 changing hands. Which way it runs is in the words,
                since "pieces" alone said nothing about direction and the card used to print both
                sides and leave the subtraction to you. */}
            {row.piecesNet !== 0 && (
              <span>
                {row.piecesNet > 0
                  ? `${row.piecesNet} coupons to hand over`
                  : `${-row.piecesNet} coupons owed`}
              </span>
            )}
            {toCopy !== null && (
              <CopyAmount
                value={toCopy}
                display={
                  row.mesos > 0
                    ? `${formatMesos(row.mesos, true)} owed`
                    : `you owe ${formatMesos(row.owedByYou, true)}`
                }
              />
            )}
          </span>
        </span>
        {/* Money they sent beyond anything priced, which is a payment for the pieces. Out here rather
            than in the net below: a piece debt has no price for it to count down, and netting it
            would say you owed them the moment they paid you for coupons you cannot value. */}
        {row.receivedOnPieces > 0 && (
          <span className="ledger-tally">
            <span className="ledger-amount is-paid">
              {formatMesos(row.receivedOnPieces, true)} received
            </span>
          </span>
        )}
      </header>

      {/* The money, and what it is made of. Every entered row is removable and nothing else is: the
          others are corrected where they were recorded, which is the sale or the split itself. */}
      <div className="ledger-entry">
        <span className="ledger-step">owed</span>
        {/* Nothing priced yet means no list at all, rather than the word "OWED" over a gap. */}
        {(parts.length > 0 || typed.length > 0) && (
          <ul className="ledger-queue">
            {parts.map((part) => (
              <li key={part.key} className="ledger-drop">
                {/* The nights behind the figure, where there are any. A title, because this is the
                    detail of one row rather than something the card owes everybody: the same list
                    is under its own step below, and both are the wallet's, not a third answer. */}
                <div className="ledger-drop-head" title={part.detail || undefined}>
                  <span className={part.detail ? "loot-name has-detail" : "loot-name"}>
                    {part.label}
                  </span>
                  <span
                    className={
                      "paid" in part && part.paid ? "ledger-amount is-paid" : "ledger-amount"
                    }
                  >
                    {signed(part.mesos)}
                  </span>
                </div>
              </li>
            ))}
            {typed.map((entry) => (
              <EnteredRow
                key={entry.id}
                entry={entry}
                name={row.name}
                busy={busy}
                signed={signed}
                onRemove={() => void write(onRemoveDebt(entry.id), null)}
              />
            ))}
          </ul>
        )}

        {/* The one figure on this page nothing else could have known. See V56.

            Both boxes NAME the person, and both show the shape of the answer. "owes me ___ for ___"
            was a sentence fragment two boxes long: no subject (the title is a list away), no unit,
            and nothing saying what "for" wanted. The placeholder also teaches the b/m suffix, which
            is the one thing about parseMesos nobody can guess. */}
        <form
          className="ledger-sale"
          onSubmit={(e) => {
            e.preventDefault();
            if (owing) {
              void write(onAddDebt(row.holder, owing, note.trim()), () => {
                setOwed("");
                setNote("");
              });
            }
          }}
        >
          <label className="loot-share-input">
            {row.name} owes me
            <input
              className="split-input"
              value={owed}
              onChange={(e) => setOwed(e.target.value)}
              placeholder="1.5b"
              inputMode="decimal"
              aria-label={`What ${row.name} owes you`}
            />
          </label>
          {/* No label of its own: the placeholder says what it wants in the words it wants them
              in, and "for [ ]" said neither. Optional, and the button does not wait on it. */}
          <input
            className="split-input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="what for"
            maxLength={120}
            aria-label="What it was for, optional"
          />
          <button type="submit" className="party-save" disabled={busy || owing === null}>
            Add
          </button>
        </form>

        {/* Mesos arriving, against everything above at once. A payment is against the person, not
            against a particular boss or a particular coupon. See V51. */}
        <form
          className="ledger-sale"
          onSubmit={(e) => {
            e.preventDefault();
            if (paid) void write(onAddPayment(row.holder, paid), () => setGot(""));
          }}
        >
          <label className="loot-share-input">
            {row.name} paid me
            <input
              className="split-input"
              value={got}
              onChange={(e) => setGot(e.target.value)}
              placeholder="1.5b"
              inputMode="decimal"
              aria-label={`What ${row.name} has paid you`}
            />
          </label>
          <button type="submit" className="party-save" disabled={busy || paid === null}>
            Add
          </button>
        </form>

        {/* Every entered row is removable, and this is the only place a payment is entered. It used
            to be taken back on the Sale Ledger, on a card that held the old per-holder tranches; that
            card is gone and this is where the act happened anyway. */}
        {payments.length > 0 && (
          <span className="ledger-tranches">
            {payments.map((got) => (
              <span key={got.id} className="ledger-tranche">
                {`${formatMesos(got.amount, true)} paid`}
                <button
                  type="button"
                  className="link ledger-drop-sale"
                  disabled={busy}
                  onClick={() => void write(onRemovePayment(got.id), null)}
                  aria-label={`Remove the ${formatMesos(got.amount, true)} payment`}
                >
                  ×
                </button>
              </span>
            ))}
          </span>
        )}
      </div>

      {/* The shares behind the figure above, and the one button that marks every one of them paid.
          The act the Wallet used to perform, against the same payout rows. BOTH directions are
          listed and one button covers them, because a relationship is settled by one transfer of
          the difference and that marks every share behind it paid at once. Each line is signed, so
          a list holding both ways round says which is which without a word. */}
      {row.lines.length > 0 && (
        <div className="ledger-entry">
          <span className="ledger-step">shares</span>
          <ul className="ledger-queue">
            {row.lines.map((line) => {
              const boss = bossByKey.get(line.bossKey ?? "");
              const party = partyById.get(line.partyId);
              return (
                <li key={`${line.lootId}:${line.theirsId}`} className="ledger-drop">
                  <div className="ledger-drop-head">
                    <Link href={`/bosses/parties/${line.partyId}`} className="loot-name">
                      {line.name}
                    </Link>
                    <span className="loot-meta">
                      {boss ? bossLabel(boss.name, party?.difficulty ?? null) : "Unknown boss"} ·{" "}
                      {line.theirs}
                    </span>
                    <span className="ledger-amount">
                      {signed(line.direction === "owe" ? -line.nets : line.nets)}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
          {/* What it will do, beside the button that does it, the way Mark settled names the bosses
              it closes. One act now covers shares in both directions, so the count is the thing
              worth saying before it runs. Reversible from the party page, share by share.

              A share you OWE says so instead of counting. Settling one declares the money has
              already gone, which takes it OUT of the netting above and puts what they owe you back
              UP: Jonathan settled a 139m share expecting it to come off a 254b debt and watched the
              figure rise. Leaving it unsettled is what nets it, and one transfer settles the lot. */}
          {/* Discharged against what they owe you, rather than by money crossing. One act, so the
              share stops being outstanding and the figure it was netting against does not move.

              The shares YOU owe, and only those. Handed every line it also marked their shares to you
              paid, so the offset quietly collected money nobody had sent: the net fell by whatever
              they owed. Settle is the act that covers both directions, because there a transfer of the
              difference really did happen. */}
          {offset.offered && (
            <span className="ledger-settle">
              <button
                type="button"
                className="party-save"
                disabled={busy}
                onClick={() =>
                  void write(
                    onOffsetShares(row.holder, offset.amount, row.name, owedByYouShares(row)),
                    null,
                  )
                }
              >
                Offset
              </button>
              {/* What it leaves behind, where their debt cannot cover the lot. Said, because the
                  alternative is a button promising to take 800m off a 500m debt. */}
              <span className="ledger-progress">
                {offset.leftOwing > 0
                  ? `clears what ${row.name} owes you, leaving you owing ${formatMesos(offset.leftOwing, true)}`
                  : `takes ${formatMesos(offset.amount, true)} off what ${row.name} owes you`}
              </span>
            </span>
          )}

          {/* You actually sent them the mesos. Named for the direction, so it cannot be read as the
              collecting act above it or as the offset beside it. */}
          {sendable && (
            <span className="ledger-settle">
              <button
                type="button"
                className="party-save"
                disabled={busy}
                onClick={() => void write(onSettleShares(owedByYouShares(row)), null)}
              >
                Mark sent
              </button>
              <span className="ledger-progress">
                {`records ${formatMesos(owes, true)} sent to ${row.name}`}
              </span>
            </span>
          )}

          {collectable && (
            <span className="ledger-settle">
              <button
                type="button"
                className="party-save"
                disabled={busy}
                onClick={() => void write(onSettleShares(sharesOf(row)), null)}
              >
                Settle
              </button>
              <span className="ledger-progress">
                {owes
                  ? `also records ${formatMesos(owes, true)} sent to ${row.name}`
                  : `marks ${row.lines.length} ${row.lines.length === 1 ? "share" : "shares"} paid`}
              </span>
            </span>
          )}
        </div>
      )}

      {/* What has already come off, folded to one line.

          Its own step because it is a different question from the one above: `owed` is a standing
          fact, this is a history of acts. Mixed into one list an offset read as a debt, told apart
          only by a chevron, and every press of Offset added a line that never left again.

          FOLDED, because this is the half that grows without bound. Three acts against one person
          were three near-identical rows burying the one that said what he owed. The count and the
          total are on the line, so nothing is hidden by folding it: what is inside is which act and
          when, and that is what a reader opens it for. */}
      {discharges.length > 0 && (
        <div className="ledger-entry">
          <span className="ledger-step">already off</span>
          <ul className="ledger-queue">
            <li className="ledger-drop">
              <div className="ledger-drop-head">
                <button
                  type="button"
                  className="party-row-toggle"
                  aria-expanded={showOff}
                  aria-controls={`off-${row.key}`}
                  onClick={() => setShowOff((o) => !o)}
                >
                  <span className="party-row-chevron" aria-hidden="true" />
                  <span className="visually-hidden">
                    {showOff ? "Hide what has come off" : "Show what has come off"}
                  </span>
                </button>
                <span className="loot-name">
                  {`${discharges.length} ${discharges.length === 1 ? "offset" : "offsets"}`}
                </span>
                <span className="ledger-amount">{signed(-discharged)}</span>
              </div>

              {/* A queue, not a share list. `.loot-shares > li` is a wrapping ROW with a rule above
                  it, and a `.ledger-drop` is a COLUMN with a rule down its left: nesting one in the
                  other gave every act both, so the rows came out with a stray top border and two
                  indents fighting. Drop rows go in a drop queue. */}
              {showOff && (
                <ul className="ledger-queue" id={`off-${row.key}`}>
                  {discharges.map((act) => (
                    <DischargeRow
                      key={act.id}
                      act={act}
                      name={row.name}
                      shares={nightsBehind(act.payouts)}
                      iconUrl={iconUrl}
                      busy={busy}
                      signed={signed}
                      onRemove={() =>
                        void write(
                          act.source === "DEBT" ? onRemoveDebt(act.id) : onRemoveDisposal(act.id),
                          null,
                        )
                      }
                    />
                  ))}
                </ul>
              )}
            </li>
          </ul>
        </div>
      )}

      {/* Their money, sitting in your hands, with nothing decided about it yet.

          Two things can happen to it and they end in different places, so the card asks rather than
          choosing: OFFSET takes it off what they owe you, PAID means you sent it and their debt never
          moved. Until one is recorded it is outside the net entirely, which is why this block is not
          under `owed` with the parts. See V61. */}
      {(row.holding > 0 || paidOut.length > 0) && (
        <div className="ledger-entry">
          <span className="ledger-step">{`${row.name}'s money I'm holding`}</span>
          {row.holding > 0 && (
            <>
              <span className="ledger-amount">{formatMesos(row.holding, true)}</span>
              <span className="ledger-settle">
                <button
                  type="button"
                  className="party-save"
                  disabled={busy}
                  onClick={() =>
                    void write(onDisposeProceeds(row.holder, row.holding, "OFFSET"), null)
                  }
                >
                  Offset
                </button>
                <button
                  type="button"
                  className="party-save"
                  disabled={busy}
                  onClick={() =>
                    void write(onDisposeProceeds(row.holder, row.holding, "PAID"), null)
                  }
                >
                  I paid them
                </button>
                <span className="ledger-progress">
                  {`takes ${formatMesos(row.holding, true)} off what ${row.name} owes you, or sends it`}
                </span>
              </span>
            </>
          )}
          {/* Only what was SENT to them. A decision to offset took something off what they owe you,
              so it is said under `already off` with everything else that did: one place for one kind
              of fact. Paying them out took nothing off, which is exactly why it stays here, beside
              the money it came out of.

              Removable, and only here: nothing else on any screen records one. */}
          {paidOut.length > 0 && (
            <span className="ledger-tranches">
              {paidOut.map((disposal) => (
                <span key={disposal.id} className="ledger-tranche">
                  {`${formatMesos(disposal.amount, true)} paid out`}
                  <button
                    type="button"
                    className="link ledger-drop-sale"
                    disabled={busy}
                    onClick={() => void write(onRemoveDisposal(disposal.id), null)}
                    aria-label={`Undo ${formatMesos(disposal.amount, true)} paid out to ${row.name}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </span>
          )}
        </div>
      )}

      {/* The nights the coupons are still sitting on, both directions, and the act that closes them.
          No price on either side: what a coupon fetched is only known where somebody sold it and said
          so, and that is already money on the card above.

          Headed by WHOSE INVENTORY, not by "pieces". Each list is one side of the netted count in the
          header and already subtracted from it, so under a bare "PIECES" they read as a claim on top:
          a card netting to 130 listed a 20 under it, and 20 was not 20 more.

          Drawn whenever there is a night, even where none of them can be closed. The button is what
          the refusal takes away, never the list: a card that went quiet about what is outstanding
          would be hiding exactly what it is for.

          NOT drawn when the two sides cancel. Nothing is outstanding in coupons, so there is nothing
          to hand over and nothing to read: the coupon relationship is a running balance, and a
          balance at zero is not a thing anybody has to close. It comes straight back the moment a
          night tips it either way, with every night still on it. */}
      {row.piecesNet !== 0 && (row.drops.length > 0 || row.owedDrops.length > 0) && (
        <div className="ledger-entry">
          {row.drops.length > 0 && (
            <>
              <span className="ledger-step">{`${row.name} is holding`}</span>
              <PieceNights drops={row.drops} bossByKey={bossByKey} partyById={partyById} />
              <Covered pieces={row.piecesAnswered.yours} />
              {/* The one thing the netting cannot decide for the two of you. Their coupons come off
                  what you owe them ONLY if they agree to that; they may want the mesos and to give
                  the coupons back. So it is an act with a price on it, never an assumption, and
                  until somebody records one the pieces stay a count. Same act as the purchase on the
                  Sale Ledger, from the other end: see V50 and V56. */}
              {/* What has been agreed already, and the only place it can be taken back: the Sale
                  Ledger draws your own piles alone, so a tranche against theirs has a pill nowhere
                  else. A mistyped one re-prices this card. */}
              {keptRows.length > 0 && (
                <span className="ledger-tranches">
                  {keptRows.map((tranche) => (
                    <span key={tranche.id} className="ledger-tranche">
                      {`${tranche.pieces} kept for ${formatMesos(tranche.amount ?? 0, true)}`}
                      <button
                        type="button"
                        className="link ledger-drop-sale"
                        disabled={busy}
                        onClick={() => void write(onRemoveKeep(tranche.id), null)}
                        aria-label={`Remove ${tranche.pieces} coupons ${row.name} kept`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </span>
              )}
              {row.pieces > 0 && (
                <form
                  className="ledger-sale"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (keeps)
                      void write(onKeepPieces(row.holder, row.pieces, keeps), () => setKept(""));
                  }}
                >
                  <label className="loot-share-input">
                    {`${row.name} keeps ${row.pieces} for`}
                    <input
                      className="split-input"
                      value={kept}
                      onChange={(e) => setKept(e.target.value)}
                      placeholder="400m"
                      inputMode="decimal"
                      aria-label={`What ${row.name} pays to keep the ${row.pieces} coupons of yours`}
                    />
                  </label>
                  <button type="submit" className="party-save" disabled={busy || keeps === null}>
                    Add
                  </button>
                </form>
              )}
            </>
          )}
          {row.owedDrops.length > 0 && (
            <>
              <span className="ledger-step">I am holding</span>
              <PieceNights drops={row.owedDrops} bossByKey={bossByKey} partyById={partyById} />
              <Covered pieces={row.piecesAnswered.theirs} />
            </>
          )}

          {/* One act for both sides. Closing a single side is what took your own coupons out of the
              netting and answered "60 to hand over" by asking for 80. See settleThePair. */}
          <span className="ledger-settle">
            {pair.offered && (
              <button
                type="button"
                className="party-save"
                disabled={busy}
                onClick={() => void write(onSettlePair(row.holder, pair.theirs, pair.yours), null)}
              >
                Mark settled
              </button>
            )}
            <span className="ledger-progress">
              {pair.offered && `closes ${pair.bosses} ${pair.bosses === 1 ? "boss" : "bosses"}`}
              {/* A night owing a third person cannot be closed for one of them, so it stays open and
                  is said. Silence here would be the count quietly going short. */}
              {pair.shared > 0 &&
                `${pair.offered ? ", " : ""}${pair.shared} shared with others, not closed here`}
            </span>
          </span>
        </div>
      )}

      {refusal && <span className="split-error">{refusal}</span>}
    </section>
  );
}

/**
 * How many of the nights above are already paid for, where any are.
 *
 * The list is GROSS and has to be: a tranche names a person and never a boss, so there is no night to
 * take the sold pieces off and no honest way to shorten it. Without this line a card with 150 listed
 * and 20 outstanding showed the 150 and said nothing, which is the same debt read twice: once as
 * coupons here and once as mesos in the money above.
 *
 * The subtraction, not the conclusion. What is left is the header's, and saying it here as well would
 * be the third place one figure lives.
 */
function Covered({ pieces }: { pieces: number }) {
  if (pieces <= 0) return null;
  return <span className="ledger-progress">{`${pieces} sold, priced above`}</span>;
}

/** The day part of a timestamp, this list being a history of days rather than of minutes. */
const dayOf = (at: string) => formatDropped(at.slice(0, 10));

/**
 * One act that came off, read the way every other drop row on this account is read.
 *
 * Almost every offset covers ONE share, so the act row used to be a free-text note and a count with
 * the night itself a second fold down: two clicks to reach "which drop was that", and the middle row
 * saying nothing but "offset against Bro". Where there is one share, its drop IS the row.
 *
 * Several shares keep the fold, because then the act really is a group and no single night names it.
 * A coupon sale has no night, a tranche naming a person and never a boss, so it opens onto the sales
 * instead: what was sold, for what, and when. It reached the card as the bare word "coupon sale"
 * beside 2.41b, and nothing anywhere said that was 130 coupons over two nights.
 */
function DischargeRow({
  act,
  name,
  shares,
  iconUrl,
  busy,
  signed,
  onRemove,
}: {
  act: Discharge;
  name: string;
  shares: OffsetShare[];
  /** The coupon's own sprite, for the rows whose every piece is one. See CouponSale. */
  iconUrl: string | null;
  busy: boolean;
  signed: (mesos: number) => string;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const one = shares.length === 1 ? shares[0]! : null;
  const oneSale = act.sales.length === 1 ? act.sales[0]! : null;
  // What the act was made of, where it is made of coupons. The count the row was missing.
  const pieces = act.sales.reduce((sum, sale) => sum + sale.pieces, 0);
  // Anything the row cannot hold on one line. A single night or a single sale IS the row, so only a
  // group of either opens.
  const folds = shares.length > 1 || act.sales.length > 1;
  // The drop's own art where there is one drop, and the coupon's where the act is coupons: every
  // piece of a sale is one, so there is no other sprite it could be.
  const art = one?.iconUrl ?? (pieces > 0 ? iconUrl : null);

  /**
   * What the row cannot hold, on hover rather than on it.
   *
   * The row carries the figure, the art, what fell and the day, and those are what it is scanned for.
   * The boss, who was there and what the lot made are three more things: on the line they wrapped it
   * onto two and then three, and a history you cannot scan is a history nobody reads.
   */
  const behind = (
    one
      ? [
          one.boss,
          one.members.join(", "),
          one.on && formatDropped(one.on),
          // The lot it came out of, so the share can be checked against it rather than taken on
          // trust. Absent on a drop that never sold, which owes nobody anything.
          one.sale !== null && `sold for ${formatMesos(one.sale, true)}`,
        ]
      : oneSale
        ? [
            // The lot behind the share, which is the same check the drop rows offer. Where the whole
            // lot was theirs the two figures are one, so quoting both would say it twice.
            oneSale.pieces === oneSale.lot.pieces
              ? "the whole lot"
              : `${oneSale.pieces} of a ${oneSale.lot.pieces} coupon lot`,
            `sold for ${formatMesos(oneSale.lot.amount, true)}`,
          ]
        : [
            shares.length > 1 && `${shares.length} nights`,
            act.sales.length > 1 && `${act.sales.length} sales`,
          ]
  )
    .filter(Boolean)
    .join(" · ");
  const panelId = `act-${act.id}`;

  return (
    <li className="ledger-drop">
      {/* ONE LINE. The row is a history entry and a history is scanned, so what it must hold is the
          figure, the art, what fell and the day it came off. Everything else is the title above. */}
      <div className="ledger-drop-head is-oneline" title={behind || undefined}>
        {folds ? (
          <button
            type="button"
            className="party-row-toggle"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((o) => !o)}
          >
            <span className="party-row-chevron" aria-hidden="true" />
            {/* Named, because a screen reader gets no chevron and no count off the row: whichever
                list is behind this one is what opening it reads out. */}
            <span className="visually-hidden">
              {`${open ? "Hide" : "Show"} the ${
                shares.length > 1 ? `${shares.length} nights` : `${act.sales.length} sales`
              }`}
            </span>
          </button>
        ) : (
          // The frame is kept so a single-night row lines up with a folded one.
          <span className="party-row-toggle is-empty" aria-hidden="true" />
        )}

        {art ? (
          <img className="loot-icon" src={apiAssetUrl(art)} alt="" />
        ) : (
          <span className="loot-icon" aria-hidden="true" />
        )}

        {one && one.partyId ? (
          <Link href={`/bosses/parties/${one.partyId}`} className="loot-name has-detail">
            {one.item}
          </Link>
        ) : (
          <span className="loot-name has-detail">
            {one ? one.item : pieces > 0 ? `${pieces} coupons sold` : act.label}
          </span>
        )}

        {/* The day the act was recorded, on every row and meaning the same thing on every row. It is
            what tells two offsets against one person apart, and it was in the title where nothing
            said there was a title. NOT the day the drop fell, which is a different fact and stays
            on hover: one column cannot mean two things down one list. */}
        <span className="loot-meta ledger-when">{dayOf(act.at)}</span>

        <span className="ledger-amount">{signed(-act.amount)}</span>
        <button
          type="button"
          className="link ledger-drop-sale"
          disabled={busy}
          onClick={onRemove}
          aria-label={`Undo ${formatMesos(act.amount, true)} off what ${name} owes you`}
        >
          ×
        </button>
      </div>

      {open && folds && (
        <ul className="loot-shares" id={panelId}>
          {shares.map((share) => (
            <li key={share.key}>
              <span className="loot-share-name">{share.item}</span>
              <span className="loot-share-nets">
                {[share.boss, share.on && formatDropped(share.on)].filter(Boolean).join(" · ")}
              </span>
              <span className="ledger-amount">{signed(-share.share)}</span>
            </li>
          ))}
          {/* Keyed by position: a tranche's id is not carried this far, and it has nothing to say
              here that its pieces and its day do not. */}
          {act.sales.map((sale, i) => (
            <li key={`sale-${i}`}>
              <span className="loot-share-name">{`${sale.pieces} coupons`}</span>
              <span className="loot-share-nets">
                {[
                  sale.soldAt && dayOf(sale.soldAt),
                  // Only where the sale was not all theirs. Their share of a mixed lot is a figure
                  // nobody can check without the lot it was divided out of.
                  sale.pieces !== sale.lot.pieces &&
                    `of ${sale.lot.pieces} for ${formatMesos(sale.lot.amount, true)}`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
              <span className="ledger-amount">{signed(-sale.mesos)}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * One side's nights, whichever inventory they are in.
 *
 * Both lists are the same row, so they are one component: two copies would be two places for the
 * boss label and the week to drift apart, on a card whose whole point is that the two sides are the
 * same debt read from opposite ends.
 */
function PieceNights({
  drops,
  bossByKey,
  partyById,
}: {
  drops: HeldOfYours[];
  bossByKey: Map<string, Boss>;
  partyById: Map<string, Party>;
}) {
  return (
    <ul className="ledger-queue">
      {/* A night a sale already answered for is at zero, and it is still one of the nights closing
          the pair would close: it is kept in the list for that and drawn in none. See
          spendOldestFirst. */}
      {drops
        .filter((drop) => drop.pieces > 0)
        .map((drop) => {
          const boss = bossByKey.get(drop.bossKey ?? "");
          const party = partyById.get(drop.partyId);
          return (
            <li key={`${drop.lootId}:${drop.pieces}`} className="ledger-drop">
              <div className="ledger-drop-head">
                <Link href={`/bosses/parties/${drop.partyId}`} className="loot-name">
                  {boss ? bossLabel(boss.name, party?.difficulty ?? null) : "Unknown boss"}
                </Link>
                <span className="loot-meta">
                  {drop.looterName} · week of {formatWeekStart(drop.weekStart)}
                  {/* Why this one is not in the count above. Said on the row it belongs to, rather
                      than as a second sentence under the button. */}
                  {drop.shared && " · owes somebody else too"}
                </span>
                <span className="ledger-amount">{drop.pieces}</span>
              </div>
            </li>
          );
        })}
    </ul>
  );
}

/**
 * One entered adjustment, opening onto the shares it discharged.
 *
 * A hand-typed debt names none and draws as a plain row. An OFFSET names as many as it covered, and
 * folds: the flat list then grows by one row per offset however many nights went into it, which is
 * what keeps a card with hundreds of them readable.
 */
/**
 * One debt somebody typed.
 *
 * No fold and no shares any more: an entry that names a share is a DISCHARGE and is drawn under
 * `already off` by DischargeRow, which puts the drop itself on the row rather than a note and a
 * count. What is left here names nothing, so the chevron never had anything to open.
 */
function EnteredRow({
  entry,
  name,
  busy,
  signed,
  onRemove,
}: {
  entry: SettlementDebt;
  name: string;
  busy: boolean;
  signed: (mesos: number) => string;
  onRemove: () => void;
}) {
  return (
    <li className="ledger-drop">
      <div className="ledger-drop-head">
        {/* The frame is kept so a typed row lines up with a folded one, as a drop row does. */}
        <span className="party-row-toggle is-empty" aria-hidden="true" />
        <span className="loot-name">{entry.note ?? "entered"}</span>
        <span className="ledger-amount">{signed(entry.amount)}</span>
        <button
          type="button"
          className="link ledger-drop-sale"
          disabled={busy}
          onClick={onRemove}
          aria-label={`Remove ${formatMesos(entry.amount, true)} against ${name}`}
        >
          ×
        </button>
      </div>
    </li>
  );
}
