"use client";

import type { Settlement, SettlementTotals } from "@/lib/settlement";
import { formatMesos } from "@/lib/drop-split";

// The account's position, above the cards.
//
// Three totals and no more. A line per person went here too and was taken straight back out: the
// cards below say the same thing, at more length and with something to do about it, so the strip was
// a second list of the same names half a screen above the first.
//
// Every figure is summed off the CARDS. The Wallet had its own pass over the pools, which is how two
// surfaces come to give two answers.

export function SettlementSummary({
  rows,
  totals,
}: {
  rows: Settlement[];
  totals: SettlementTotals;
}) {
  if (rows.length === 0) return null;

  return (
    <div className="stat-row">
      <div className="stat-tile">
        <span className="stat-label">Amount Owed</span>
        <span className="stat-value is-good">{formatMesos(totals.owed, true)}</span>
      </div>
      <div className="stat-tile">
        <span className="stat-label">Amount You Owe</span>
        <span className="stat-value">{formatMesos(totals.owe, true)}</span>
      </div>
      <div className="stat-tile">
        <span className="stat-label">Net</span>
        <span className={totals.net < 0 ? "stat-value is-warn" : "stat-value is-good"}>
          {formatMesos(totals.net, true)}
        </span>
      </div>
    </div>
  );
}
