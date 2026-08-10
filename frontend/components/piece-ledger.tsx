"use client";

import Link from "next/link";
import { useState } from "react";
import { apiAssetUrl } from "@/lib/api";
import { formatWeekStart } from "@/lib/boss-clears";
import { bossLabel } from "@/lib/boss-difficulty";
import { formatMesos, parseMesos, shortMesos } from "@/lib/drop-split";
import { transferKey } from "@/lib/piece-ledger";
import { type Holder, type HolderLedger, holderKey, toCome, unsold } from "@/lib/vestige-ledger";
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
  onRemoveSale: (trancheId: string) => Promise<void>;
  onRemovePayment: (paymentId: string) => Promise<void>;
}) {
  if (ledgers.length === 0) return null;
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
  onRemoveSale: (trancheId: string) => Promise<void>;
  onRemovePayment: (paymentId: string) => Promise<void>;
}) {
  const [pieces, setPieces] = useState("");
  const [amount, setAmount] = useState("");
  const [keeping, setKeeping] = useState("");
  const [buying, setBuying] = useState("");
  const [buyingFor, setBuyingFor] = useState("");
  const [got, setGot] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);

  // The pile's own progress, which belongs beside the boxes that take its numbers rather than in
  // the header. Sold counts against the sellable part: a redeemed piece was never going to sell.
  const left = unsold(ledger);
  const sellable = ledger.drops.reduce((sum, d) => sum + d.sellable, 0);
  const sold = sellable - left;

  // Your side, in the units you are owed. What the header leads with.
  const toGo = ledger.owedToYou - ledger.settledToYou;
  const over = ledger.kept - ledger.pieces;

  const count = Number(pieces.trim());
  const total = parseMesos(amount);
  // A total above zero, matching V47: a stack that fetched nothing is the kept box beside this one,
  // not a sale for nought. Refused here as well so the button greys out rather than round-tripping.
  const sale =
    Number.isInteger(count) && count >= 1 && count <= MAX_PIECES && total !== null && total >= 1
      ? { pieces: count, amount: total }
      : null;

  /**
   * Redemptions stop at the holder's OWN share, purchases at what is left of yours.
   *
   * Two boxes because the pieces past their share are not theirs to redeem, and pricing them at the
   * average their own sales reached was a guess that got wilder the less pile was left. Bounding the
   * redemption is only safe because the purchase box exists to take what it turns away: clamping with
   * nowhere for the surplus to go would record 195 of a 250 that really happened and leave 55 of your
   * pieces waiting on a sale that is not coming. See V50.
   *
   * Rows already entered count against both, so three of them cannot walk past what one cannot.
   */
  const keptRoom = Math.max(0, ledger.ownShare - ledger.kept);
  const boughtRoom = Math.max(0, ledger.pieces - ledger.ownShare - ledger.bought.pieces);

  /** Caps as it is typed, so a number over the room never reaches the button. */
  const clamp = (typed: string, room: number) => {
    const n = Number(typed.trim());
    return typed.trim() === "" || !Number.isInteger(n) || n <= room ? typed : String(room);
  };

  const gotTotal = parseMesos(got);
  const payment = gotTotal !== null && gotTotal >= 1 ? gotTotal : null;

  const keptCount = Number(keeping.trim());
  const kept =
    Number.isInteger(keptCount) && keptCount >= 1 && keptCount <= Math.min(MAX_PIECES, keptRoom)
      ? keptCount
      : null;

  const buyCount = Number(buying.trim());
  const buyTotal = parseMesos(buyingFor);
  const bought =
    Number.isInteger(buyCount) &&
    buyCount >= 1 &&
    buyCount <= Math.min(MAX_PIECES, boughtRoom) &&
    buyTotal !== null &&
    buyTotal >= 1
      ? { pieces: buyCount, amount: buyTotal }
      : null;

  /** Keeps what was typed when the server refuses it, so a rejected sale can be corrected. */
  async function write(action: Promise<void>, clear: "sale" | "kept" | "bought" | "paid" | null) {
    setRefusal(null);
    try {
      await action;
      if (clear === "sale") {
        setPieces("");
        setAmount("");
      }
      if (clear === "kept") setKeeping("");
      if (clear === "bought") {
        setBuying("");
        setBuyingFor("");
      }
      if (clear === "paid") setGot("");
    } catch (e) {
      setRefusal(e instanceof Error ? e.message : "That didn't save.");
    }
  }

  return (
    <section className="ledger-card">
      <header className="ledger-head">
        {iconUrl ? (
          <img className="loot-icon" src={apiAssetUrl(iconUrl)} alt="" />
        ) : (
          <span className="loot-icon" aria-hidden="true" />
        )}
        <span className="loot-title">
          <span className="loot-name">Vestige of Erion</span>
          <span className="loot-meta">
            {/* YOUR side, in the units you are owed. The pile's own numbers moved down to the boxes
                that take them: leading with one frame and counting in the other is what made "why
                do I enter 390 when I am owed 195" a question the card kept provoking. */}
            {ledger.holder.kind === "SELF"
              ? `you hold ${ledger.pieces}`
              : `${ledger.holderName} owes you ${ledger.owedToYou} pieces · ${ledger.settledToYou} priced · ${toGo} to go`}
          </span>
        </span>
        <span className="ledger-tally">
          {/* Due NOW against what has arrived. Priced and paid are different facts, and showing only
              the first is what left a fully sold pile reading exactly like one still waiting. The
              money says "settled" and drops the figure once it is all in. See V51. */}
          {ledger.settled
            ? ledger.dueNow > 0 && <span className="loot-share-nets">settled</span>
            : ledger.dueNow > 0 && (
                <span className="droplog-take">
                  {formatMesos(toCome(ledger), true)}
                  {ledger.received > 0 ? " to come" : " due"}
                </span>
              )}
        </span>
      </header>

      <div className="ledger-entry">
        <form
          className="ledger-sale"
          onSubmit={(e) => {
            e.preventDefault();
            if (sale) void write(onAddSale(ledger.holder, sale.pieces, sale.amount), "sale");
          }}
        >
          <label className="loot-share-input">
            sold
            <input
              className="split-input loot-count-input"
              value={pieces}
              onChange={(e) => setPieces(e.target.value)}
              placeholder="pieces"
              inputMode="numeric"
              aria-label={`Pieces ${ledger.holderName} sold`}
            />
          </label>
          <label className="loot-share-input">
            for
            <input
              className="split-input"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="total"
              inputMode="decimal"
              aria-label={`What ${ledger.holderName} got for them`}
            />
          </label>
          <button type="submit" className="party-save" disabled={busy || sale === null}>
            Add sale
          </button>
        </form>

        {/* Its own form, and no amount: a redemption realized nothing, and entering it as a sale for
            zero would price those pieces at nothing and make the creditor absorb half of it. */}
        <form
          className="ledger-sale"
          onSubmit={(e) => {
            e.preventDefault();
            if (kept) void write(onAddKept(ledger.holder, kept), "kept");
          }}
        >
          <label className="loot-share-input">
            kept
            <input
              className="split-input loot-count-input"
              value={keeping}
              onChange={(e) => setKeeping(clamp(e.target.value, keptRoom))}
              placeholder="pieces"
              inputMode="numeric"
              aria-label={`Pieces ${ledger.holderName} is keeping, at most ${keptRoom}`}
            />
          </label>
          <button type="submit" className="party-save" disabled={busy || kept === null}>
            Add kept
          </button>
        </form>

        {/* Pieces of YOURS they took. An amount, because the alternative is pricing them at whatever
            their own sales happened to reach, and off the pile, because they never went to market.
            Only on somebody else's card: you cannot buy from yourself. See V50. */}
        {ledger.holder.kind !== "SELF" && boughtRoom + ledger.bought.pieces > 0 && (
          <form
            className="ledger-sale"
            onSubmit={(e) => {
              e.preventDefault();
              if (bought)
                void write(onAddBought(ledger.holder, bought.pieces, bought.amount), "bought");
            }}
          >
            <label className="loot-share-input">
              took mine
              <input
                className="split-input loot-count-input"
                value={buying}
                onChange={(e) => setBuying(clamp(e.target.value, boughtRoom))}
                placeholder="pieces"
                inputMode="numeric"
                aria-label={`Pieces of yours ${ledger.holderName} took, at most ${boughtRoom}`}
              />
            </label>
            <label className="loot-share-input">
              for
              <input
                className="split-input"
                value={buyingFor}
                onChange={(e) => setBuyingFor(e.target.value)}
                placeholder="total"
                inputMode="decimal"
                aria-label={`What ${ledger.holderName} pays you for them`}
              />
            </label>
            <button type="submit" className="party-save" disabled={busy || bought === null}>
              Add
            </button>
          </form>
        )}

        {/* The one fact nothing else can know: the mesos arrived. Every other figure here follows
            from what happened to the coupons, so without this a pile whose every piece was sold and
            priced still read as outstanding. Only on somebody else's card, and only once there is
            something to collect. See V51. */}
        {ledger.holder.kind !== "SELF" && ledger.dueNow > 0 && (
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
                placeholder={toCome(ledger) > 0 ? shortMesos(toCome(ledger)) : "amount"}
                inputMode="decimal"
                aria-label={`What ${ledger.holderName} has paid you`}
              />
            </label>
            <button type="submit" className="party-save" disabled={busy || payment === null}>
              Add
            </button>
          </form>
        )}

        <span className="ledger-tranches">
          {/* The PILE's frame, beside the boxes that take its numbers. */}
          <span>
            {sold} of {sellable} sold
            {ledger.kept > 0 &&
              (over > 0 ? ` · ${ledger.kept} kept, over by ${over}` : ` · ${ledger.kept} kept`)}
            {ledger.bought.pieces > 0 && ` · ${ledger.bought.pieces} of mine taken`}
            {/* Overpayment is said rather than netted off: more arriving than is owed is a miscount
                on one side, and a figure that quietly absorbed it would hide which. */}
            {ledger.received > 0 &&
              (ledger.received > ledger.dueNow
                ? ` · ${shortMesos(ledger.received)} paid, ${shortMesos(ledger.received - ledger.dueNow)} over`
                : ` · ${shortMesos(ledger.received)} of ${shortMesos(ledger.dueNow)} paid`)}
          </span>

          {/* What has been entered, in the order the queue spends it. Removable because a mistyped
              tranche re-prices every boss behind it, and there is nowhere else to correct one. */}
          {/* Receipts, removable because a mistyped one says a bill is settled when it is not, and
              this is the only place it can be corrected. See V51. */}
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

        {refusal && <span className="split-error">{refusal}</span>}
      </div>

      <ul className="ledger-queue">
        {ledger.drops.map((drop) => {
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
