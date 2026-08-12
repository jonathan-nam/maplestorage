"use client";

import Link from "next/link";
import { useState } from "react";
import { formatWeekStart } from "@/lib/boss-clears";
import { bossLabel } from "@/lib/boss-difficulty";
import { type Collection, sharesOf } from "@/lib/collection";
import { formatMesos, parseMesos } from "@/lib/drop-split";
import type { Holder } from "@/lib/vestige-ledger";
import type { Boss } from "@/types/boss";
import type { Party } from "@/types/party";

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

// Two tones, and they say OUTSTANDING against SETTLED. Never which direction a figure runs: the
// sign and the wording carry that already, and a colour repeating it would spend the card's one
// signal on something said twice.
//
// Green is PAID, matching .loot-paid.is-paid on a share badge, which has meant exactly that since
// long before this card existed. It went the other way round here first, green for collectable, so
// money already received and money still owed read alike and green meant the opposite of what it
// means one page across.

export function CollectionLedger({
  rows,
  bossByKey,
  partyById,
  busy,
  onAddPayment,
  onAddDebt,
  onRemoveDebt,
  onSettlePieces,
  onSettleShares,
}: {
  rows: Collection[];
  bossByKey: Map<string, Boss>;
  partyById: Map<string, Party>;
  busy: boolean;
  onAddPayment: (holder: Holder, amount: number) => Promise<void>;
  onAddDebt: (holder: Holder, amount: number, note: string) => Promise<void>;
  onRemoveDebt: (debtId: string) => Promise<void>;
  onSettlePieces: (holder: Holder, lootIds: string[]) => Promise<void>;
  onSettleShares: (payouts: { lootId: string; memberId: string }[]) => Promise<void>;
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
          busy={busy}
          onAddPayment={onAddPayment}
          onAddDebt={onAddDebt}
          onRemoveDebt={onRemoveDebt}
          onSettlePieces={onSettlePieces}
          onSettleShares={onSettleShares}
        />
      ))}
    </>
  );
}

function CollectionCard({
  row,
  bossByKey,
  partyById,
  busy,
  onAddPayment,
  onAddDebt,
  onRemoveDebt,
  onSettlePieces,
  onSettleShares,
}: {
  row: Collection;
  bossByKey: Map<string, Boss>;
  partyById: Map<string, Party>;
  busy: boolean;
  onAddPayment: (holder: Holder, amount: number) => Promise<void>;
  onAddDebt: (holder: Holder, amount: number, note: string) => Promise<void>;
  onRemoveDebt: (debtId: string) => Promise<void>;
  onSettlePieces: (holder: Holder, lootIds: string[]) => Promise<void>;
  onSettleShares: (payouts: { lootId: string; memberId: string }[]) => Promise<void>;
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

  // Mesos this settle would declare you have ALREADY sent. Zero when every line runs towards you,
  // which is the ordinary case and the one the button reads naturally for.
  const owes = row.lines
    .filter((line) => line.direction === "owe")
    .reduce((sum, line) => sum + line.pay, 0);

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
                    className={`ledger-amount ${"paid" in part && part.paid ? "is-paid" : "is-open"}`}
                  >
                    {formatMesos(part.mesos, true)}
                  </span>
                </div>
              </li>
            ))}
            {row.entries.map((entry) => (
              <li key={entry.id} className="ledger-drop">
                <div className="ledger-drop-head">
                  <span className="loot-name">{entry.note ?? "entered"}</span>
                  <span className="ledger-amount is-open">{formatMesos(entry.amount, true)}</span>
                  <button
                    type="button"
                    className="link ledger-drop-sale"
                    disabled={busy}
                    onClick={() => void write(onRemoveDebt(entry.id), null)}
                    aria-label={`Remove ${formatMesos(entry.amount, true)} owed by ${row.name}`}
                  >
                    ×
                  </button>
                </div>
              </li>
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
                    <span className="ledger-amount is-open">
                      {formatMesos(line.direction === "owe" ? -line.nets : line.nets, true)}
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
                ? `records ${formatMesos(owes, true)} sent to ${row.name}`
                : `marks ${row.lines.length} ${row.lines.length === 1 ? "share" : "shares"} paid`}
            </span>
          </span>
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
                    <span className="ledger-amount is-open">{drop.pieces}</span>
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
