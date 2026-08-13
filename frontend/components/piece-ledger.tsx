"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { apiAssetUrl } from "@/lib/api";
import { formatWeekStart } from "@/lib/boss-clears";
import { bossLabel } from "@/lib/boss-difficulty";
import { formatMesos, parseMesos, shortMesos } from "@/lib/drop-split";
import { FATES, type Fate, asksAnything, owes, roomFor, settledOf } from "@/lib/ledger-fates";
import { transferKey } from "@/lib/piece-ledger";
import {
  type Holder,
  type HolderLedger,
  holderKey,
  pieceCreditors,
  unaccounted,
} from "@/lib/vestige-ledger";
import type { Boss } from "@/types/boss";
import type { Party } from "@/types/party";
import type { VestigeTranche, VestigeTrancheShare } from "@/types/vestige";

// Your own pile: the coupons you are holding, the box that says what became of them, and the bosses
// they came off.
//
// Only piles you can sell out of reach this card. What somebody ELSE holds is a debt rather than a
// sale, and it is the Settlement Ledger's, stated in pieces: see lib/settlement.ts.
//
// A person, not a character. One human running three characters has one pile and one box, and each
// boss row names which of their characters looted it, so the fold hides nothing.
//
// Nothing here computes a meso, and there is no longer one to compute. Every figure comes off the
// HolderLedger, which is lib/vestige-ledger.ts's, which is lib/piece-ledger.ts's.

/** What a sale is refused for, mirroring trancheRefusal in VestigeRoutes.kt. */
const MAX_PIECES = 1_000_000;

/**
 * What the picker calls each fate, on somebody else's card and on your own.
 *
 * One control rather than three boxes, because it is one row: they are mutually exclusive fates for
 * the same pieces, and asking all three at once asked four questions when there is only ever one.
 *
 * Two wordings because the card is drawn for a pile you are looking at and for one you are holding,
 * and "they took mine" on your own pile says the opposite of what it would mean.
 */
const LABELS: Record<Fate, { theirs: string; yours: string }> = {
  SOLD: { theirs: "they sold, on the market", yours: "I sold, on the market" },
  KEPT: { theirs: "they kept, their own share", yours: "I kept, my own share" },
  BOUGHT: { theirs: "they took mine, at a price", yours: "I took theirs, at a price" },
};

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
  focusEntry = false,
}: {
  ledgers: HolderLedger[];
  /** Every holder's tranches, keyed by holderKey(), oldest first as the server returns them. */
  tranches: Map<string, VestigeTranche[]>;
  bossByKey: Map<string, Boss>;
  partyById: Map<string, Party>;
  /** The coupon's own sprite, backend-relative. Null when the catalog has no art for it. */
  iconUrl: string | null;
  busy: boolean;
  onAddSale: (
    holder: Holder,
    pieces: number,
    amount: number,
    shares: VestigeTrancheShare[],
  ) => Promise<void>;
  onAddKept: (holder: Holder, pieces: number) => Promise<void>;
  onAddBought: (holder: Holder, pieces: number, amount: number) => Promise<void>;
  onRemoveSale: (trancheId: string) => Promise<void>;
  /**
   * Puts the cursor in the first card's count box.
   *
   * Set where a card is drawn by a click rather than by having something to answer: the cursor is
   * what says the click produced this. Off everywhere else, since stealing focus on load moves the
   * page under a reader who did not ask for it.
   */
  focusEntry?: boolean;
}) {
  if (ledgers.length === 0) return null;
  // Every card, settled ones included. These bosses drop vestiges on every clear, so a holder's card is
  // a fixture rather than a task: hiding a settled one only means it reappears next week, and a card
  // that says "fully settled" answers the question a missing card leaves open.
  return (
    <>
      {ledgers.map((ledger, i) => (
        <HolderCard
          key={holderKey(ledger.holder)}
          ledger={ledger}
          focusEntry={focusEntry && i === 0}
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
  focusEntry,
}: {
  ledger: HolderLedger;
  tranches: VestigeTranche[];
  bossByKey: Map<string, Boss>;
  partyById: Map<string, Party>;
  iconUrl: string | null;
  busy: boolean;
  onAddSale: (
    holder: Holder,
    pieces: number,
    amount: number,
    shares: VestigeTrancheShare[],
  ) => Promise<void>;
  onAddKept: (holder: Holder, pieces: number) => Promise<void>;
  onAddBought: (holder: Holder, pieces: number, amount: number) => Promise<void>;
  onRemoveSale: (trancheId: string) => Promise<void>;
  focusEntry: boolean;
}) {
  const [pieces, setPieces] = useState("");
  const [amount, setAmount] = useState("");
  const [fate, setFate] = useState<Fate>("SOLD");
  const [refusal, setRefusal] = useState<string | null>(null);
  /** Pieces of the sale that were each creditor's, as typed, keyed by holderKey. */
  const [theirs, setTheirs] = useState<Record<string, string>>({});
  const entryRef = useRef<HTMLInputElement>(null);

  // On mount only, which is the click that drew this card: focus is what ties the two together, and
  // taking it back later would move the cursor out from under somebody mid-type.
  useEffect(() => {
    if (focusEntry) entryRef.current?.focus();
  }, [focusEntry]);

  // Who this pile owes coupons to. Asked only on a SALE: a redemption realized nothing to divide and
  // a purchase is already one creditor's in full at an agreed price. See V50 and V56.
  const creditors = pieceCreditors(ledger);
  // For naming a share on a tranche already entered, which pieceCreditors cannot: it drops the
  // closed drops, and a sale attributed before the boss was settled still says whose it was.
  const creditorNames = new Map(
    ledger.drops.flatMap((d) => d.transfers).map((t) => [t.toId, t.to]),
  );

  const overEntered = Math.max(0, ledger.accounted - ledger.pieces);
  const toEnter = unaccounted(ledger);

  const room = roomFor(ledger, fate);

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

  /**
   * Whose pieces this sale was, as far as it has been said.
   *
   * Only what somebody typed. Nothing is inferred from what the pile owes: which of the coupons in
   * one inventory went to market is not knowable from here, and guessing at it would credit the wrong
   * person a real amount of money. Empty is the whole sale being the seller's own.
   */
  const attributed = creditors
    .map((c) => ({ key: c.key, holder: c.holder, pieces: Number((theirs[c.key] ?? "").trim()) }))
    .filter((s) => Number.isInteger(s.pieces) && s.pieces >= 1);
  const attributedPieces = attributed.reduce((sum, s) => sum + s.pieces, 0);
  // More of the sale given away than it held, which the server refuses too. Said rather than
  // clamped: the reader typed both numbers, and which of them is wrong is theirs to decide.
  const overAttributed = fate === "SOLD" && entry !== null && attributedPieces > entry.pieces;

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
        setTheirs({});
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
        {/* The card's one instruction, and it is a COUNT rather than a sentence. No prose explains the
            boxes; the picker's options carry the vocabulary, the way the looter select does on a party
            config.

            The count is the DEBT, not the pile. Of 1160 coupons in your inventory 1150 were your own,
            and counting those demanded 1160 answers for a 10-piece debt. The form stays either way:
            recording a sale is offered, it is just never demanded. See asksAnything. */}
        {asksAnything(ledger) && (
          <span className="ledger-progress">
            {settledOf(ledger) < owes(ledger)
              ? `${settledOf(ledger)} of ${owes(ledger)} pieces accounted for`
              : `all ${ledger.pieces} accounted for, ${overEntered} over`}
          </span>
        )}

        {/* ONE form, because all three are one tranche row: a count, which of the three things happened
            to it, and a price for the two that have one. Three separate boxes asked four questions at
            once and permanently, when at any moment there is only ever this one. */}
        {(toEnter > 0 || ledger.pieces === 0) && (
          <form
            className="ledger-sale"
            onSubmit={(e) => {
              e.preventDefault();
              if (!entry || overAttributed) return;
              if (fate === "SOLD")
                void write(
                  onAddSale(
                    ledger.holder,
                    entry.pieces,
                    entry.amount ?? 0,
                    attributed.map((s) => ({ holder: s.holder, pieces: s.pieces })),
                  ),
                  "entry",
                );
              if (fate === "KEPT") void write(onAddKept(ledger.holder, entry.pieces), "entry");
              if (fate === "BOUGHT")
                void write(onAddBought(ledger.holder, entry.pieces, entry.amount ?? 0), "entry");
            }}
          >
            <input
              ref={entryRef}
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
              {/* All three on every card. BOUGHT was hidden on your own, which read as "you cannot
                  buy your own coupons" and meant "the pieces in your pile that are somebody else's
                  can only be sold": a pile you meant to keep never reached all-accounted-for. */}
              {FATES.map((f) => (
                <option key={f} value={f}>
                  {ledger.holder.kind === "SELF" ? LABELS[f].yours : LABELS[f].theirs}
                </option>
              ))}
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
            <button
              type="submit"
              className="party-save"
              disabled={busy || entry === null || overAttributed}
            >
              Add
            </button>
          </form>
        )}

        {/* Whose pieces the sale was, one box per person this pile owes. The one place a coupon debt
            gets a price, and it only can here: these pieces were in YOUR inventory, so the figure
            being divided is one you just typed. What somebody else sold at is still not asked for,
            and still could not be answered. See V56.

            Nothing is prefilled. The box a sale wants is usually the whole debt, but "usually" is
            what would quietly credit a person for coupons that are still sitting there. */}
        {fate === "SOLD" && creditors.length > 0 && (toEnter > 0 || ledger.pieces === 0) && (
          <div className="ledger-attribution">
            {creditors.map((creditor) => {
              const cut = attributed.find((s) => s.key === creditor.key)?.pieces ?? 0;
              // Their slice of THIS sale, at this sale's own price. Exact within one tranche, which
              // is one lot at one price. The rounding remainder stays on your side.
              const worth =
                entry?.amount && cut > 0 ? Math.round((cut * entry.amount) / entry.pieces) : 0;
              return (
                <label key={creditor.key} className="loot-share-input">
                  of which {creditor.name}&apos;s
                  <input
                    className="split-input loot-count-input"
                    value={theirs[creditor.key] ?? ""}
                    onChange={(e) =>
                      setTheirs((t) => ({
                        ...t,
                        [creditor.key]: clamp(e.target.value, creditor.pieces),
                      }))
                    }
                    inputMode="numeric"
                    aria-label={`Pieces of this sale that were ${creditor.name}'s, at most ${creditor.pieces}`}
                  />
                  {worth > 0 && <span className="loot-share-nets">{shortMesos(worth)}</span>}
                </label>
              );
            })}
            {overAttributed && (
              <span className="split-error">
                {`${attributedPieces} of a sale of ${entry?.pieces}`}
              </span>
            )}
          </div>
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
              {/* Whose pieces it was, where it was not all the seller's. On the row rather than in
                  a total, because this is where a mistyped one is corrected: the ledger's figure for
                  that person moves the moment this row goes. */}
              {(tranche.shares ?? []).map((share) => (
                <span key={holderKey(share.holder)} className="loot-share-nets">
                  {`${share.pieces} ${creditorNames.get(holderKey(share.holder)) ?? "theirs"}`}
                </span>
              ))}
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
