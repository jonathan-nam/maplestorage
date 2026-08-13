"use client";

import { useState } from "react";
import { formatMesos, shortMesos } from "@/lib/drop-split";
import type { Holder } from "@/lib/vestige-ledger";
import type { VestigePayment, VestigeTranche } from "@/types/vestige";

// The rows already recorded against somebody else's pile, and nothing else.
//
// Their sales used to be entered here, tranche by tranche, so a meso figure could be derived pro
// rata. That is gone: a piece debt is stated in pieces on the Settlement Ledger and settled by one
// payment, because coupons are single-trade and only the holder can sell them.
//
// The rows entered under the old shape still exist, and this card is the only place they can be
// corrected. It states no debt and no total, so it cannot disagree with the Settlement Ledger about
// what anybody owes: it is a list of what was typed, with a way to untype it.
//
// It draws only for a holder who HAS such rows, so it dies out on its own as each old pile is
// cleared, and this file goes with it.

export function TrancheHistory({
  holders,
  tranches,
  payments,
  busy,
  onRemoveSale,
  onRemovePayment,
}: {
  /** Whose rows these are, keyed by holderKey(). Only holders with something recorded. */
  holders: { key: string; holder: Holder; name: string }[];
  tranches: Map<string, VestigeTranche[]>;
  payments: Map<string, VestigePayment[]>;
  busy: boolean;
  onRemoveSale: (trancheId: string) => Promise<void>;
  onRemovePayment: (paymentId: string) => Promise<void>;
}) {
  if (holders.length === 0) return null;
  return (
    <>
      {holders.map((holder) => (
        <HistoryCard
          key={holder.key}
          name={holder.name}
          tranches={tranches.get(holder.key) ?? []}
          payments={payments.get(holder.key) ?? []}
          busy={busy}
          onRemoveSale={onRemoveSale}
          onRemovePayment={onRemovePayment}
        />
      ))}
    </>
  );
}

function HistoryCard({
  name,
  tranches,
  payments,
  busy,
  onRemoveSale,
  onRemovePayment,
}: {
  name: string;
  tranches: VestigeTranche[];
  payments: VestigePayment[];
  busy: boolean;
  onRemoveSale: (trancheId: string) => Promise<void>;
  onRemovePayment: (paymentId: string) => Promise<void>;
}) {
  const [refusal, setRefusal] = useState<string | null>(null);

  async function write(action: Promise<void>) {
    setRefusal(null);
    try {
      await action;
    } catch (e) {
      setRefusal(e instanceof Error ? e.message : "That didn't save.");
    }
  }

  return (
    <section className="ledger-card">
      <header className="ledger-head">
        <span className="loot-title">
          <span className="loot-name">{name}</span>
          <span className="loot-meta">recorded</span>
        </span>
      </header>

      <div className="ledger-entry">
        {tranches.length > 0 && (
          <>
            <span className="ledger-step">pieces</span>
            <span className="ledger-tranches">
              {tranches.map((tranche) => (
                <span key={tranche.id} className="ledger-tranche">
                  {tranche.amount === null
                    ? `${tranche.pieces} kept`
                    : `${tranche.pieces} @ ${shortMesos(tranche.amount / tranche.pieces)}${
                        tranche.disposition === "BOUGHT" ? " taken" : ""
                      }`}
                  <button
                    type="button"
                    className="link ledger-drop-sale"
                    disabled={busy}
                    onClick={() => void write(onRemoveSale(tranche.id))}
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
          </>
        )}

        {payments.length > 0 && (
          <>
            <span className="ledger-step">money</span>
            <span className="ledger-tranches">
              {payments.map((paid) => (
                <span key={paid.id} className="ledger-tranche">
                  {`${shortMesos(paid.amount)} paid`}
                  <button
                    type="button"
                    className="link ledger-drop-sale"
                    disabled={busy}
                    onClick={() => void write(onRemovePayment(paid.id))}
                    aria-label={`Remove the ${formatMesos(paid.amount, true)} payment`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </span>
          </>
        )}

        {refusal && <span className="split-error">{refusal}</span>}
      </div>
    </section>
  );
}
