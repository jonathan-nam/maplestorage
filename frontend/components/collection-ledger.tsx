"use client";

import Link from "next/link";
import { useState } from "react";
import { formatWeekStart } from "@/lib/boss-clears";
import { bossLabel } from "@/lib/boss-difficulty";
import { type Collection, owedByYouShares, sharesOf } from "@/lib/collection";
import { formatMesos, parseMesos } from "@/lib/drop-split";
import type { Holder } from "@/lib/vestige-ledger";
import type { Boss } from "@/types/boss";
import type { Party } from "@/types/party";
import type { CollectionDebt } from "@/types/vestige";

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
// Nothing here computes a meso. Every number comes off lib/collection.ts.

// COLOUR ONLY WHERE "DONE OR NOT" IS A REAL QUESTION, which is the headline and the money that has
// arrived. Red for outstanding, green for paid, green matching .loot-paid.is-paid on a share badge
// so one app cannot have it mean settled on one page and outstanding on the next.
//
// The parts under a card are ARITHMETIC: components that sum to the headline. "Settled" cannot be
// asked of one. Colouring them anyway put a figure like -139,548,023 in red for being unsettled
// while it was also a credit AGAINST the debt above it, so the same number read as a problem and as
// progress at once. The sign carries them instead, and every one of them is signed.

export function CollectionLedger({
  rows,
  bossByKey,
  partyById,
  seatById,
  lootBoss,
  busy,
  onAddPayment,
  onAddDebt,
  onRemoveDebt,
  onSettlePieces,
  onSettleShares,
  onOffsetShares,
}: {
  rows: Collection[];
  bossByKey: Map<string, Boss>;
  partyById: Map<string, Party>;
  /** Every seat by id, for naming the share an offset discharged. See V58. */
  seatById: Map<string, { name: string; partyId: string }>;
  /** Each loot row's boss key, for the same. */
  lootBoss: Map<string, string | null>;
  busy: boolean;
  onAddPayment: (holder: Holder, amount: number) => Promise<void>;
  onAddDebt: (holder: Holder, amount: number, note: string) => Promise<void>;
  onRemoveDebt: (debtId: string) => Promise<void>;
  onSettlePieces: (holder: Holder, lootIds: string[]) => Promise<void>;
  onSettleShares: (payouts: { lootId: string; memberId: string }[]) => Promise<void>;
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
        <CollectionCard
          key={row.key}
          row={row}
          bossByKey={bossByKey}
          partyById={partyById}
          seatById={seatById}
          lootBoss={lootBoss}
          busy={busy}
          onAddPayment={onAddPayment}
          onAddDebt={onAddDebt}
          onRemoveDebt={onRemoveDebt}
          onSettlePieces={onSettlePieces}
          onSettleShares={onSettleShares}
          onOffsetShares={onOffsetShares}
        />
      ))}
    </>
  );
}

function CollectionCard({
  row,
  bossByKey,
  partyById,
  seatById,
  lootBoss,
  busy,
  onAddPayment,
  onAddDebt,
  onRemoveDebt,
  onSettlePieces,
  onSettleShares,
  onOffsetShares,
}: {
  row: Collection;
  bossByKey: Map<string, Boss>;
  partyById: Map<string, Party>;
  /** Every seat by id, for naming the share an offset discharged. See V58. */
  seatById: Map<string, { name: string; partyId: string }>;
  /** Each loot row's boss key, for the same. */
  lootBoss: Map<string, string | null>;
  busy: boolean;
  onAddPayment: (holder: Holder, amount: number) => Promise<void>;
  onAddDebt: (holder: Holder, amount: number, note: string) => Promise<void>;
  onRemoveDebt: (debtId: string) => Promise<void>;
  onSettlePieces: (holder: Holder, lootIds: string[]) => Promise<void>;
  onSettleShares: (payouts: { lootId: string; memberId: string }[]) => Promise<void>;
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
  const [note, setNote] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);

  const payment = parseMesos(got);
  const paid = payment !== null && payment >= 1 ? payment : null;
  const entered = parseMesos(owed);
  const owing = entered !== null && entered >= 1 ? entered : null;

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
  const summary = [
    row.pieces > 0 ? `${row.pieces} pieces` : null,
    row.mesos > 0 ? `${formatMesos(row.mesos, true)} owed` : null,
    row.owedByYou > 0 ? `you owe ${formatMesos(row.owedByYou, true)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

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
    {
      key: "sold",
      label: `${row.name}'s coupons I sold`,
      mesos: row.parts.soldOfTheirs,
    },
    {
      key: "theirs",
      label: `my coupons ${row.name} sold`,
      mesos: row.parts.soldOfYours,
    },
    // Money that has ARRIVED. Not owing and not owed: it is the one part that is finished, so it
    // reads as neither, and a ledger where the settled money is the same colour as the outstanding
    // money is a ledger you have to read twice.
    { key: "received", label: "received", mesos: row.parts.received, paid: true },
  ].filter((part) => part.mesos !== 0);

  // Mesos a settle would declare you have ALREADY sent. Zero when every line runs towards you.
  const owes = row.lines
    .filter((line) => line.direction === "owe")
    .reduce((sum, line) => sum + line.pay, 0);
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
   * Whether a share you owe can be discharged by taking it OFF what they owe you.
   *
   * The settlement two people actually make when the sums are lopsided: rather than send somebody
   * 139,548,023 and have them send 254b back, it comes off the larger figure. Marking the share paid
   * alone said the money had moved, which took it out of the netting and put what they owe you back
   * UP, and that is the opposite of what happened. See V57.
   *
   * Needs a debt of theirs to come off. Offsetting against nothing is not an offset, it is just a
   * debt of yours, and this ledger has no act for paying one.
   */
  const offsettable = owes > 0 && row.mesos > 0;
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
   * The shares one entry discharged, named. Empty for a hand-entered debt, which names none.
   *
   * Off the pools rather than the wallet's lines: the settle that made this offset marked those
   * shares PAID, so they have left the wallet by the time this row is drawn. That is the whole
   * reason V58 stores them.
   */
  const sharesBehind = (entry: CollectionDebt) =>
    entry.payouts.map((share) => {
      const seat = seatById.get(share.memberId);
      const boss = bossByKey.get(lootBoss.get(share.lootId) ?? "");
      const party = seat ? partyById.get(seat.partyId) : undefined;
      return {
        key: `${share.lootId}:${share.memberId}`,
        where: boss ? bossLabel(boss.name, party?.difficulty ?? null) : "Unknown boss",
        who: seat?.name ?? "a seat that has left",
      };
    });

  return (
    <section className="ledger-card">
      <header className="ledger-head">
        <span className="loot-title">
          <span className="loot-name">{row.name}</span>
          {/* The direction the whole card runs, coloured as the parts below it are, so the headline
              and its own arithmetic never read as two different kinds of thing. */}
          <span className={"loot-meta ledger-summary is-open"}>{summary}</span>
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
        {(parts.length > 0 || row.entries.length > 0) && (
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
            {row.entries.map((entry) => (
              <EnteredRow
                key={entry.id}
                entry={entry}
                name={row.name}
                shares={sharesBehind(entry)}
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
              share stops being outstanding and the figure it was netting against does not move. */}
          {offsettable && (
            <span className="ledger-settle">
              <button
                type="button"
                className="party-save"
                disabled={busy}
                onClick={() =>
                  void write(onOffsetShares(row.holder, owes, row.name, sharesOf(row)), null)
                }
              >
                Offset
              </button>
              <span className="ledger-progress">
                {`takes ${formatMesos(owes, true)} off what ${row.name} owes you`}
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

      {/* The pieces: a count, and the act that closes it. Still no price, because these are in THEIR
          inventory and only they can sell them. The pieces you owe are priced instead by the sale you
          entered, which is above as one of the parts. */}
      {row.pieces > 0 && (
        <div className="ledger-entry">
          <span className="ledger-step">pieces</span>
          <ul className="ledger-queue">
            {row.drops.map((drop) => {
              const boss = bossByKey.get(drop.bossKey ?? "");
              const party = partyById.get(drop.partyId);
              return (
                <li key={drop.lootId} className="ledger-drop">
                  <div className="ledger-drop-head">
                    <Link href={`/bosses/parties/${drop.partyId}`} className="loot-name">
                      {boss ? bossLabel(boss.name, party?.difficulty ?? null) : "Unknown boss"}
                    </Link>
                    <span className="loot-meta">
                      {drop.looterName} · week of {formatWeekStart(drop.weekStart)}
                    </span>
                    <span className="ledger-amount">{drop.pieces}</span>
                  </div>
                </li>
              );
            })}
          </ul>

          <span className="ledger-settle">
            <button
              type="button"
              className="party-save"
              disabled={busy}
              onClick={() =>
                void write(
                  onSettlePieces(
                    row.holder,
                    row.drops.map((d) => d.lootId),
                  ),
                  null,
                )
              }
            >
              Mark settled
            </button>
            <span className="ledger-progress">
              {`closes ${row.drops.length} ${row.drops.length === 1 ? "boss" : "bosses"}`}
            </span>
          </span>
        </div>
      )}

      {refusal && <span className="split-error">{refusal}</span>}
    </section>
  );
}

/**
 * One entered adjustment, opening onto the shares it discharged.
 *
 * A hand-typed debt names none and draws as a plain row. An OFFSET names as many as it covered, and
 * folds: the flat list then grows by one row per offset however many nights went into it, which is
 * what keeps a card with hundreds of them readable.
 */
function EnteredRow({
  entry,
  name,
  shares,
  busy,
  signed,
  onRemove,
}: {
  entry: CollectionDebt;
  name: string;
  shares: { key: string; where: string; who: string }[];
  busy: boolean;
  signed: (mesos: number) => string;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const panelId = `entry-${entry.id}`;
  const label = entry.note ?? "entered";
  const count = `${shares.length} ${shares.length === 1 ? "share" : "shares"}`;

  return (
    <li className="ledger-drop">
      <div className="ledger-drop-head">
        {shares.length > 0 ? (
          <button
            type="button"
            className="party-row-toggle"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((o) => !o)}
          >
            <span className="party-row-chevron" aria-hidden="true" />
            <span className="visually-hidden">
              {open ? `Hide the ${count} behind ${label}` : `Show the ${count} behind ${label}`}
            </span>
          </button>
        ) : (
          // The frame is kept so a typed row lines up with a folded one, as a drop row does.
          <span className="party-row-toggle is-empty" aria-hidden="true" />
        )}
        <span className="loot-name">
          {label}
          {shares.length > 0 && <span className="loot-meta"> · {count}</span>}
        </span>
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

      {open && (
        <ul className="loot-shares" id={panelId}>
          {shares.map((share) => (
            <li key={share.key}>
              <span className="loot-share-name">{share.where}</span>
              <span className="loot-share-nets">{share.who}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
