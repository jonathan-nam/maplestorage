"use client";

import Link from "next/link";
import { useState } from "react";
import { apiAssetUrl } from "@/lib/api";
import { formatWeekStart } from "@/lib/boss-clears";
import { bossLabel } from "@/lib/boss-difficulty";
import { formatMesos, parseMesos, shortMesos } from "@/lib/drop-split";
import { transferKey } from "@/lib/piece-ledger";
import {
  type Holder,
  type HolderLedger,
  holderKey,
  toCome,
  unaccounted,
} from "@/lib/vestige-ledger";
import type { Boss } from "@/types/boss";
import type { Party } from "@/types/party";
import type { VestigePayment, VestigeTranche } from "@/types/vestige";

// One card per HOLDER: the pile a person is holding, the one box that prices it, and what each boss
// they looted for owes once its own pieces are covered.
//
// A person, not a character. One human running three characters has one pile and one box, and each
// boss row names which of their characters looted it, so the fold hides nothing.
//
// Nothing here computes a meso. Every figure comes off the HolderLedger, which is
// lib/vestige-ledger.ts's, which is lib/piece-ledger.ts's. The one thing this file decides is what
// to draw when a figure is not yet knowable, and the answer is the pieces and no money: a boss
// whose pieces are still unsold has no price, and an average of the tranches so far would be a
// number the next tranche moves.

/** What a sale is refused for, mirroring trancheRefusal in VestigeRoutes.kt. */
const MAX_PIECES = 1_000_000;

/**
 * What became of a count of pieces. The three dispositions V50 stores, as the picker offers them.
 *
 * One control rather than three boxes, because it is one row: they are mutually exclusive fates for
 * the same pieces, and asking all three at once asked four questions when there is only ever one.
 */
type Fate = "SOLD" | "KEPT" | "BOUGHT";

export function PieceLedger({
  ledgers,
  tranches,
  payments,
  bossByKey,
  partyById,
  iconUrl,
  busy,
  onAddSale,
  onAddKept,
  onAddBought,
  onAddPayment,
  onSettle,
  onRemoveSale,
  onRemovePayment,
}: {
  ledgers: HolderLedger[];
  /** Every holder's tranches, keyed by holderKey(), oldest first as the server returns them. */
  tranches: Map<string, VestigeTranche[]>;
  /** Every holder's receipts, keyed the same way. See V51. */
  payments: Map<string, VestigePayment[]>;
  bossByKey: Map<string, Boss>;
  partyById: Map<string, Party>;
  /** The coupon's own sprite, backend-relative. Null when the catalog has no art for it. */
  iconUrl: string | null;
  busy: boolean;
  onAddSale: (holder: Holder, pieces: number, amount: number) => Promise<void>;
  onAddKept: (holder: Holder, pieces: number) => Promise<void>;
  onAddBought: (holder: Holder, pieces: number, amount: number) => Promise<void>;
  onAddPayment: (holder: Holder, amount: number) => Promise<void>;
  onSettle: (holder: Holder, lootIds: string[], unpaid: number) => Promise<void>;
  onRemoveSale: (trancheId: string) => Promise<void>;
  onRemovePayment: (paymentId: string) => Promise<void>;
}) {
  if (ledgers.length === 0) return null;
  // Every card, settled ones included. These bosses drop vestiges on every clear, so a holder's card is
  // a fixture rather than a task: hiding a settled one only means it reappears next week, and a card
  // that says "fully settled" answers the question a missing card leaves open.
  return (
    <>
      {ledgers.map((ledger) => (
        <HolderCard
          key={holderKey(ledger.holder)}
          ledger={ledger}
          tranches={tranches.get(holderKey(ledger.holder)) ?? []}
          payments={payments.get(holderKey(ledger.holder)) ?? []}
          bossByKey={bossByKey}
          partyById={partyById}
          iconUrl={iconUrl}
          busy={busy}
          onAddSale={onAddSale}
          onAddKept={onAddKept}
          onAddBought={onAddBought}
          onAddPayment={onAddPayment}
          onSettle={onSettle}
          onRemoveSale={onRemoveSale}
          onRemovePayment={onRemovePayment}
        />
      ))}
    </>
  );
}

function HolderCard({
  ledger,
  tranches,
  payments,
  bossByKey,
  partyById,
  iconUrl,
  busy,
  onAddSale,
  onAddKept,
  onAddBought,
  onAddPayment,
  onSettle,
  onRemoveSale,
  onRemovePayment,
}: {
  ledger: HolderLedger;
  tranches: VestigeTranche[];
  payments: VestigePayment[];
  bossByKey: Map<string, Boss>;
  partyById: Map<string, Party>;
  iconUrl: string | null;
  busy: boolean;
  onAddSale: (holder: Holder, pieces: number, amount: number) => Promise<void>;
  onAddKept: (holder: Holder, pieces: number) => Promise<void>;
  onAddBought: (holder: Holder, pieces: number, amount: number) => Promise<void>;
  onAddPayment: (holder: Holder, amount: number) => Promise<void>;
  onSettle: (holder: Holder, lootIds: string[], unpaid: number) => Promise<void>;
  onRemoveSale: (trancheId: string) => Promise<void>;
  onRemovePayment: (paymentId: string) => Promise<void>;
}) {
  const [pieces, setPieces] = useState("");
  const [amount, setAmount] = useState("");
  const [fate, setFate] = useState<Fate>("SOLD");
  const [got, setGot] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);

  // Your side, in the units you are owed. What the header leads with.
  const toGo = ledger.owedToYou - ledger.settledToYou;
  const overEntered = Math.max(0, ledger.accounted - ledger.pieces);
  const toEnter = unaccounted(ledger);

  /**
   * How many pieces this fate has room for.
   *
   * A redemption stops at the holder's OWN share and a purchase at what is left of yours, because the
   * pieces past their share are not theirs to redeem. Bounding the redemption is only safe because the
   * purchase exists to take what it turns away: clamping with nowhere for the surplus to go would
   * record 195 of a 250 that really happened and leave 55 of your pieces waiting on a sale that is not
   * coming. See V50.
   *
   * A sale is bounded only by what is unaccounted for. It is not a claim about whose pieces they were,
   * so there is no share to measure it against.
   *
   * Rows already entered count against all three, so three of them cannot walk past what one cannot.
   */
  const room =
    fate === "KEPT"
      ? Math.min(toEnter, Math.max(0, ledger.ownShare - ledger.kept))
      : fate === "BOUGHT"
        ? Math.min(toEnter, Math.max(0, ledger.pieces - ledger.ownShare - ledger.bought.pieces))
        : toEnter;

  /** Caps as it is typed, so a number over the room never reaches the button. */
  const clamp = (typed: string, cap: number) => {
    const n = Number(typed.trim());
    return typed.trim() === "" || !Number.isInteger(n) || n <= cap ? typed : String(cap);
  };

  const count = Number(pieces.trim());
  const total = parseMesos(amount);
  /**
   * The row as typed, or null while it cannot be written.
   *
   * A total above zero on the two fates that carry one, matching V47 and V50: a stack that fetched
   * nothing is a redemption, not a sale for nought. Refused here as well as on the server, so the
   * button greys out rather than round-tripping.
   */
  const entry =
    Number.isInteger(count) && count >= 1 && count <= Math.min(MAX_PIECES, room)
      ? fate === "KEPT"
        ? { pieces: count, amount: null }
        : total !== null && total >= 1
          ? { pieces: count, amount: total }
          : null
      : null;

  const gotTotal = parseMesos(got);
  const payment = gotTotal !== null && gotTotal >= 1 ? gotTotal : null;

  // The drops still open under this holder: what Mark settled would close, and what the queue lists.
  // A closed drop stays in the LEDGER, because the tranches were spent across the whole pile, and only
  // stops being drawn. See V52.
  const open = ledger.drops.filter((d) => !d.closed);
  const openLoot = open.map((d) => d.lootId);
  const closedCount = ledger.drops.length - open.length;

  /** Keeps what was typed when the server refuses it, so a rejected sale can be corrected. */
  async function write(action: Promise<void>, clear: "entry" | "paid" | null) {
    setRefusal(null);
    try {
      await action;
      if (clear === "entry") {
        setPieces("");
        setAmount("");
      }
      if (clear === "paid") setGot("");
    } catch (e) {
      setRefusal(e instanceof Error ? e.message : "That didn't save.");
    }
  }

  return (
    <section className="ledger-card">
      <header className="ledger-head">
        {/* The coupon is named here rather than on screen: it is the same on every card, so the
            title spends its words on the one thing that differs. */}
        {iconUrl ? (
          <img className="loot-icon" src={apiAssetUrl(iconUrl)} alt="Vestige of Erion" />
        ) : (
          <span className="loot-icon" aria-hidden="true" />
        )}
        <span className="loot-title">
          {/* WHOSE pile this is, because that is what picks the card. Every card was titled "Vestige
              of Erion", which is true of all of them and so told them apart not at all: two piles
              read as one card drawn twice, and the page exists to have a sale typed into the right
              one. Coupons are single-trade, so the pile that sold them is the person holding them. */}
          <span className="loot-name">
            {ledger.holder.kind === "SELF" ? "You" : ledger.holderName}
          </span>
          <span className="loot-meta">
            {/* YOUR side, in the units you are owed. The pile's own numbers moved down to the boxes
                that take them: leading with one frame and counting in the other is what made "why
                do I enter 390 when I am owed 195" a question the card kept provoking. */}
            {ledger.holder.kind === "SELF"
              ? `holding ${ledger.pieces}`
              : `owes you ${ledger.owedToYou} pieces · ${ledger.settledToYou} priced · ${toGo} to go`}
          </span>
        </span>
        <span className="ledger-tally">
          {/* Due NOW against what has arrived. Priced and paid are different facts, and showing only
              the first is what left a fully sold pile reading exactly like one still waiting. The
              money says "settled" and drops the figure once it is all in. See V51. */}
          {ledger.closed ? (
            <span className="ledger-done">
              {ledger.writtenOff > 0
                ? `fully settled, ${shortMesos(ledger.writtenOff)} written off`
                : "fully settled"}
            </span>
          ) : ledger.settled ? (
            // Overpayment is said rather than netted off: more arriving than was owed is a miscount
            // on one side, and a settled card that absorbed it would hide which.
            ledger.dueNow > 0 && (
              <span className="loot-share-nets">
                {ledger.received > ledger.dueNow
                  ? `settled, ${shortMesos(ledger.received - ledger.dueNow)} over`
                  : "settled"}
              </span>
            )
          ) : (
            ledger.dueNow > 0 && (
              <span className="droplog-take">
                {formatMesos(toCome(ledger), true)}
                {ledger.received > 0 ? " to come" : " due"}
              </span>
            )
          )}
        </span>
      </header>

      <div className="ledger-entry">
        {/* Two steps, in the order they happen, each with its own count, its own box and its own rows.
            The pieces and the money were one flat list of chips, so "195 kept" and "4.86b paid" read as
            the same kind of thing when one is what became of the coupons and the other is what came
            back for them. See V50 and V51. */}
        <span className="ledger-step">pieces</span>
        {/* The card's one instruction, and it is a COUNT rather than a sentence: the gap between what
            the pile holds and what has been entered is exactly what it is waiting to be told. Once it
            closes, the money below is the only question left. No prose explains the boxes; the picker's
            options carry the vocabulary, the way the looter select does on a party config. */}
        <span className="ledger-progress">
          {toEnter > 0
            ? `${ledger.accounted} of ${ledger.pieces} pieces accounted for`
            : overEntered > 0
              ? `all ${ledger.pieces} accounted for, ${overEntered} over`
              : `all ${ledger.pieces} accounted for`}
        </span>

        {/* ONE form, because all three are one tranche row: a count, which of the three things happened
            to it, and a price for the two that have one. Three separate boxes asked four questions at
            once and permanently, when at any moment there is only ever this one. */}
        {(toEnter > 0 || ledger.pieces === 0) && (
          <form
            className="ledger-sale"
            onSubmit={(e) => {
              e.preventDefault();
              if (!entry) return;
              if (fate === "SOLD")
                void write(onAddSale(ledger.holder, entry.pieces, entry.amount ?? 0), "entry");
              if (fate === "KEPT") void write(onAddKept(ledger.holder, entry.pieces), "entry");
              if (fate === "BOUGHT")
                void write(onAddBought(ledger.holder, entry.pieces, entry.amount ?? 0), "entry");
            }}
          >
            <input
              className="split-input loot-count-input"
              value={pieces}
              onChange={(e) => setPieces(clamp(e.target.value, room))}
              // The number it is waiting for, so the ordinary case is one keystroke away rather than
              // something to work out from the counts.
              placeholder={String(room > 0 ? room : ledger.pieces)}
              inputMode="numeric"
              aria-label={`Pieces, at most ${room}`}
            />
            <select
              className="split-input"
              value={fate}
              onChange={(e) => setFate(e.target.value as Fate)}
              aria-label="What happened to those pieces"
              disabled={busy}
            >
              <option value="SOLD">they sold, on the market</option>
              <option value="KEPT">they kept, their own share</option>
              {ledger.holder.kind !== "SELF" && (
                <option value="BOUGHT">they took mine, at a price</option>
              )}
            </select>
            {/* A redemption realized nothing, so it has no price to give. Entered as a sale for zero
                it would price those pieces at nothing and make the creditor absorb half of it. */}
            {fate !== "KEPT" && (
              <label className="loot-share-input">
                for
                <input
                  className="split-input"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="total"
                  inputMode="decimal"
                  aria-label="What they came to"
                />
              </label>
            )}
            <button type="submit" className="party-save" disabled={busy || entry === null}>
              Add
            </button>
          </form>
        )}

        {/* The pieces step's own rows, in the order the queue spends them. Removable because a mistyped
            tranche re-prices every boss behind it, and there is nowhere else to correct one. */}
        <span className="ledger-tranches">
          {tranches.map((tranche) => (
            <span key={tranche.id} className="ledger-tranche">
              {/* A redemption has no price, so it says what it is rather than dividing by a
                  missing amount. See V46. A purchase has one and is still not a sale, so it says
                  which it is: two rows of "60 @ 25m" that settle differently would be one row
                  repeated. See V50. */}
              {tranche.amount === null
                ? `${tranche.pieces} kept`
                : `${tranche.pieces} @ ${shortMesos(tranche.amount / tranche.pieces)}${
                    tranche.disposition === "BOUGHT" ? " taken" : ""
                  }`}
              <button
                type="button"
                className="link ledger-drop-sale"
                disabled={busy}
                onClick={() => void write(onRemoveSale(tranche.id), null)}
                aria-label={
                  tranche.amount === null
                    ? `Remove ${tranche.pieces} kept pieces`
                    : `Remove ${tranche.pieces} pieces for ${formatMesos(tranche.amount, true)}`
                }
              >
                ×
              </button>
            </span>
          ))}
        </span>

        {/* The money, and only once there is any to collect. The other half of the same sequence: a
            bill cannot exist before the pieces above it have a price. See V51. */}
        {ledger.holder.kind !== "SELF" &&
          ledger.dueNow > 0 &&
          !ledger.settled &&
          !ledger.closed && (
            <>
              <span className="ledger-step">money</span>
              <span className="ledger-progress">
                {ledger.received > 0
                  ? `${shortMesos(ledger.received)} of ${shortMesos(ledger.dueNow)} paid`
                  : `${shortMesos(ledger.dueNow)} owed`}
              </span>
              <form
                className="ledger-sale"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (payment) void write(onAddPayment(ledger.holder, payment), "paid");
                }}
              >
                <label className="loot-share-input">
                  paid me
                  <input
                    className="split-input"
                    value={got}
                    onChange={(e) => setGot(e.target.value)}
                    placeholder={shortMesos(toCome(ledger))}
                    inputMode="decimal"
                    aria-label={`What ${ledger.holderName} has paid you`}
                  />
                </label>
                <button type="submit" className="party-save" disabled={busy || payment === null}>
                  Add
                </button>
              </form>

              {/* This step's own rows. Removable because a mistyped receipt says a bill is settled when
                it is not, and this is the only place it can be corrected. See V51. */}
              {payments.length > 0 && (
                <span className="ledger-tranches">
                  {payments.map((paid) => (
                    <span key={paid.id} className="ledger-tranche">
                      {`${shortMesos(paid.amount)} paid`}
                      <button
                        type="button"
                        className="link ledger-drop-sale"
                        disabled={busy}
                        onClick={() => void write(onRemovePayment(paid.id), null)}
                        aria-label={`Remove the ${formatMesos(paid.amount, true)} payment`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </span>
              )}
            </>
          )}

        {/* The one thing about this card that cannot be derived: somebody deciding it is done. Offered
            once every piece is accounted for, and NOT once the money balances, because closing on
            "close enough" is the case it exists for. What is left owing goes on the record with it, so
            writing off 56m is a decision rather than a number that quietly vanished. See V52. */}
        {ledger.holder.kind !== "SELF" &&
          !ledger.closed &&
          toEnter === 0 &&
          openLoot.length > 0 && (
            <span className="ledger-close">
              <button
                type="button"
                className="party-save"
                disabled={busy}
                onClick={() => void write(onSettle(ledger.holder, openLoot, toCome(ledger)), null)}
              >
                Mark settled
              </button>
              <span className="ledger-progress">
                {toCome(ledger) > 0
                  ? `closes ${openLoot.length} ${openLoot.length === 1 ? "boss" : "bosses"}, ${shortMesos(toCome(ledger))} unpaid`
                  : `closes ${openLoot.length} ${openLoot.length === 1 ? "boss" : "bosses"}`}
              </span>
            </span>
          )}

        {refusal && <span className="split-error">{refusal}</span>}
      </div>

      <ul className="ledger-queue">
        {/* A closed boss is history, not something the card is waiting on, so it is off the list and
            said as a count rather than dropped. It comes back with the settlement it belongs to. */}
        {closedCount > 0 && (
          <li className="ledger-progress">
            {`${closedCount} settled${ledger.writtenOff > 0 ? `, ${shortMesos(ledger.writtenOff)} written off` : ""}`}
          </li>
        )}
        {open.map((drop) => {
          const boss = bossByKey.get(drop.bossKey ?? "");
          const party = partyById.get(drop.partyId);
          return (
            <li key={drop.lootId} className="ledger-drop">
              <div className="ledger-drop-head">
                <Link href={`/bosses/parties/${drop.partyId}`} className="loot-name">
                  {boss ? bossLabel(boss.name, party?.difficulty ?? null) : "Unknown boss"}
                </Link>
                <span className="loot-meta">
                  {/* Which inventory the pieces are in. The pile is the person's, and this is the
                      one fact that fold would otherwise lose. */}
                  {drop.looterName} · week of {formatWeekStart(drop.weekStart)}
                </span>
                {/* Against the SELLABLE part, so a pile whose sellable half has gone reads as
                    finished. Empty when there is nothing to sell: a full bar would say done and an
                    empty one would say nothing has happened, and neither is true. */}
                <span className="ledger-bar" aria-hidden="true">
                  <span
                    className="ledger-bar-fill"
                    style={{
                      width: drop.sellable > 0 ? `${(drop.covered / drop.sellable) * 100}%` : "0",
                    }}
                  />
                </span>
                <span className="loot-share-nets">
                  {drop.covered} of {drop.sellable}
                  {drop.kept > 0 && ` · ${drop.kept} kept`}
                  {drop.bought && ` · ${drop.bought.pieces} taken`}
                </span>
              </div>

              <ul className="loot-shares">
                {drop.transfers.map((transfer) => (
                  <li key={transferKey(transfer)}>
                    <span className="loot-share-name">owes {transfer.to}</span>
                    {transfer.send === null ? (
                      // None of its pieces have sold, so there is no price to pay them at. The
                      // count is the fact; money would be a guess at the next tranche.
                      //
                      // Two ways to get here and they are not the same promise. Waiting on a sale
                      // will be priced. A pile with nothing left to sell never will, and saying
                      // "when they sell" about it is a date that cannot come.
                      <span className="loot-share-nets">
                        {drop.sellable === 0
                          ? `${transfer.pieces} pieces, no sale to price them`
                          : `${transfer.pieces} pieces, priced when they sell`}
                      </span>
                    ) : (
                      <>
                        <span className="droplog-take">{formatMesos(transfer.send, true)}</span>
                        {/* No verb: a settled piece is one that sold OR one they took and paid
                            for, and "sold" was only ever true while the second could not happen. */}
                        <span className="loot-share-nets">
                          {transfer.settled < transfer.pieces
                            ? `${transfer.settled} of ${transfer.pieces} pieces`
                            : `${transfer.pieces} pieces`}
                        </span>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
