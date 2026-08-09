"use client";

import { useState } from "react";
import { apiAssetUrl } from "@/lib/api";
import { bossLabel } from "@/lib/boss-difficulty";
import { formatMesos, parseMesos } from "@/lib/drop-split";
import {
  type LotDrop,
  type LotSaleBody,
  lotSaleBody,
  nearestCounts,
  priceLot,
  proposeLot,
} from "@/lib/lot-sale";
import { formatDropped } from "@/lib/loot";
import type { Boss } from "@/types/boss";
import type { Party } from "@/types/party";

// One card per interchangeable drop you are holding unsold: the box that prices a pile of them, and
// the rows that pile would be filed against.
//
// The rows are shown before anything is written, and that is the point of the card. A queue can say
// which rows are OLDEST but not which of several identical drops actually left the inventory, so it
// proposes and you confirm. What it must never do is pick quietly.
//
// Nothing here divides anything. The per-row amounts are priceLot()'s, which is piece-ledger's
// largestRemainder, and each row's split stays splitDrop()'s once it is sold.

export function LotSale({
  drops,
  bossByKey,
  partyById,
  busy,
  onSell,
}: {
  drops: LotDrop[];
  bossByKey: Map<string, Boss>;
  partyById: Map<string, Party>;
  busy: boolean;
  onSell: (body: LotSaleBody) => Promise<void>;
}) {
  // Titled and ruled off like Add Drop on the other tab, and first on this one, because the Sale
  // Ledger opened on cards that read as a statement of what is owed rather than as somewhere to
  // type. Both tabs now begin with the thing you do.
  if (drops.length === 0) return null;
  return (
    <section className="loot-pool droplog-action">
      <h2 className="loot-pool-title">Record Sale</h2>
      {drops.map((drop) => (
        <LotCard
          key={drop.dropKey}
          drop={drop}
          bossByKey={bossByKey}
          partyById={partyById}
          busy={busy}
          onSell={onSell}
        />
      ))}
    </section>
  );
}

function LotCard({
  drop,
  bossByKey,
  partyById,
  busy,
  onSell,
}: {
  drop: LotDrop;
  bossByKey: Map<string, Boss>;
  partyById: Map<string, Party>;
  busy: boolean;
  onSell: (body: LotSaleBody) => Promise<void>;
}) {
  const [count, setCount] = useState("");
  const [amount, setAmount] = useState("");
  const [amountBasis, setAmountBasis] = useState("LISTED");
  const [splitMethod, setSplitMethod] = useState("FAIR");
  const [refusal, setRefusal] = useState<string | null>(null);

  const asked = Number(count.trim());
  const wanted = Number.isInteger(asked) && asked >= 1 ? asked : null;
  const total = parseMesos(amount);
  const proposal = wanted === null ? null : proposeLot(drop.queue, wanted);
  // Only ever over the rows the proposal actually covers, so a figure on screen is a figure that
  // would be filed. The queue's other rows are not part of this sale.
  const amounts = proposal && total !== null ? priceLot(total, proposal.rows) : null;

  // A count that does not land on a whole row. The rows either side are the choice, and saying
  // nothing here would leave a disabled button with no reason.
  const instead =
    proposal && proposal.rows.length === 0 ? nearestCounts(proposal.reachable, asked) : [];

  // The method only matters where there is somebody to divide with. Every row solo means one seat,
  // and the two methods are the same arithmetic on it: see the note in components/loot-row.tsx.
  const splits = drop.queue.some((row) => Object.keys(row.shares).length > 1);
  const ready = proposal !== null && proposal.rows.length > 0 && total !== null;

  async function sell() {
    if (!ready) return;
    setRefusal(null);
    try {
      await onSell(lotSaleBody(drop.dropKey, total!, amountBasis, splitMethod, proposal!.rows));
      setCount("");
      setAmount("");
    } catch (e) {
      setRefusal(e instanceof Error ? e.message : "That didn't save.");
    }
  }

  return (
    <section className="ledger-card">
      <header className="ledger-head">
        {drop.iconUrl ? (
          <img className="loot-icon" src={apiAssetUrl(drop.iconUrl)} alt="" />
        ) : (
          <span className="loot-icon" aria-hidden="true" />
        )}
        <span className="loot-title">
          <span className="loot-name">{drop.name}</span>
        </span>
        <span className="ledger-tally">
          {drop.units} unsold in {drop.queue.length} {drop.queue.length === 1 ? "drop" : "drops"}
        </span>
      </header>

      <form
        className="ledger-sale"
        onSubmit={(e) => {
          e.preventDefault();
          void sell();
        }}
      >
        <label className="loot-share-input">
          sold
          <input
            className="split-input loot-count-input"
            value={count}
            onChange={(e) => setCount(e.target.value)}
            placeholder="how many"
            inputMode="numeric"
            aria-label={`How many ${drop.name} you sold`}
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
            aria-label={`What you got for the ${drop.name}`}
          />
        </label>
        {/* No "member bought": a lot spans pools, and one member cannot have bought a pile out of
            parties they were not in. That case stays on the row, where it names its own buyer. */}
        <select
          className="split-input"
          value={amountBasis}
          onChange={(e) => setAmountBasis(e.target.value)}
          aria-label="What that amount is"
        >
          <option value="LISTED">listed for</option>
          <option value="RECEIVED">received</option>
        </select>
        {splits && (
          <select
            className="split-input"
            value={splitMethod}
            onChange={(e) => setSplitMethod(e.target.value)}
            aria-label="Split method"
          >
            <option value="FAIR">fair split</option>
            <option value="LAZY">lazy split</option>
          </select>
        )}
        <button type="submit" className="party-save" disabled={busy || !ready}>
          {proposal && proposal.rows.length > 0
            ? `Sell ${proposal.rows.length === 1 ? "this drop" : `these ${proposal.rows.length}`}`
            : "Sell"}
        </button>

        {instead.length > 0 && <span className="split-error">Sell {instead.join(" or ")}.</span>}
        {refusal && <span className="split-error">{refusal}</span>}
      </form>

      {proposal && proposal.rows.length > 0 && (
        <ul className="ledger-queue">
          {proposal.rows.map((row, i) => {
            const boss = bossByKey.get(row.bossKey ?? "");
            const party = partyById.get(row.partyId);
            return (
              <li key={row.lootId} className="ledger-drop">
                <div className="ledger-drop-head">
                  <span className="loot-name">
                    {boss ? bossLabel(boss.name, party?.difficulty ?? null) : "Unknown boss"}
                    {row.units > 1 && <span className="loot-count"> x{row.units}</span>}
                  </span>
                  <span className="loot-meta">
                    {row.sellerName} · {formatDropped(row.droppedOn)}
                  </span>
                  {amounts && (
                    <span className="lot-row-amount">{formatMesos(amounts[i] ?? 0, true)}</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
