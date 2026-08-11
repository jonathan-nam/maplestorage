"use client";

import Link from "next/link";
import { useState } from "react";
import { apiAssetUrl } from "@/lib/api";
import { formatWeekStart } from "@/lib/boss-clears";
import { bossLabel } from "@/lib/boss-difficulty";
import { formatMesos, parseMesos, shortMesos } from "@/lib/drop-split";
import { transferKey } from "@/lib/piece-ledger";
import { type Holder, type HolderLedger, holderKey, unaccounted } from "@/lib/vestige-ledger";
import type { Boss } from "@/types/boss";
import type { Party } from "@/types/party";
import type { VestigeTranche } from "@/types/vestige";

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
  bossByKey,
  partyById,
  iconUrl,
  busy,
  onAddSale,
  onAddKept,
  onAddBought,
  onRemoveSale,
}: {
  ledgers: HolderLedger[];
  /** Every holder's tranches, keyed by holderKey(), oldest first as the server returns them. */
  tranches: Map<string, VestigeTranche[]>;
  bossByKey: Map<string, Boss>;
  partyById: Map<string, Party>;
  /** The coupon's own sprite, backend-relative. Null when the catalog has no art for it. */
  iconUrl: string | null;
  busy: boolean;
  onAddSale: (holder: Holder, pieces: number, amount: number) => Promise<void>;
  onAddKept: (holder: Holder, pieces: number) => Promise<void>;
  onAddBought: (holder: Holder, pieces: number, amount: number) => Promise<void>;
  onRemoveSale: (trancheId: string) => Promise<void>;
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
          bossByKey={bossByKey}
          partyById={partyById}
          iconUrl={iconUrl}
          busy={busy}
          onAddSale={onAddSale}
          onAddKept={onAddKept}
          onAddBought={onAddBought}
          onRemoveSale={onRemoveSale}
        />
      ))}
    </>
  );
}

function HolderCard({
  ledger,
  tranches,
  bossByKey,
  partyById,
  iconUrl,
  busy,
  onAddSale,
  onAddKept,
  onAddBought,
  onRemoveSale,
}: {
  ledger: HolderLedger;
  tranches: VestigeTranche[];
  bossByKey: Map<string, Boss>;
  partyById: Map<string, Party>;
  iconUrl: string | null;
  busy: boolean;
  onAddSale: (holder: Holder, pieces: number, amount: number) => Promise<void>;
  onAddKept: (holder: Holder, pieces: number) => Promise<void>;
  onAddBought: (holder: Holder, pieces: number, amount: number) => Promise<void>;
  onRemoveSale: (trancheId: string) => Promise<void>;
}) {
  const [pieces, setPieces] = useState("");
  const [amount, setAmount] = useState("");
  const [fate, setFate] = useState<Fate>("SOLD");
  const [refusal, setRefusal] = useState<string | null>(null);

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

  // The bosses still open under this holder, which is what the queue lists. A closed one is history
  // and is said as a count rather than dropped. See V52.
  const open = ledger.drops.filter((d) => !d.closed);
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
          <span className="loot-meta">{`holding ${ledger.pieces}`}</span>
        </span>
        <span className="ledger-tally">
          {ledger.closed && (
            <span className="ledger-done">
              {ledger.writtenOff > 0
                ? `fully settled, ${shortMesos(ledger.writtenOff)} written off`
                : "fully settled"}
            </span>
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
                <span className="loot-share-nets">{drop.pieces}</span>
              </div>

              {/* Pieces of this night that are somebody else's, in counts. No price: only the holder
                  can sell a coupon, and what these are worth is whatever the two of you agree. */}
              <ul className="loot-shares">
                {drop.transfers.map((transfer) => (
                  <li key={transferKey(transfer)}>
                    <span className="loot-share-name">owes {transfer.to}</span>
                    <span className="loot-share-nets">{transfer.pieces} pieces</span>
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
