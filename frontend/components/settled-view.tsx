"use client";

import Link from "next/link";
import { useState } from "react";
import { apiAssetUrl } from "@/lib/api";
import { bossLabel } from "@/lib/boss-difficulty";
import { formatMesos } from "@/lib/drop-split";
import { formatDropped } from "@/lib/loot";
import { consolidateSettled } from "@/lib/settled-log";
import type { SettledLine, SettledRecord, SettledTotals } from "@/lib/settled-log";
import type { Boss } from "@/types/boss";
import type { Party } from "@/types/party";

// What is finished, and how it got that way.
//
// The one tab that asks nothing. Every other ledger is a worklist, so a row on it is something to
// do; a row here is something that happened, and the only control on it undoes the act that put it
// there. That is what lets the first three stop carrying finished rows.
//
// Nothing here computes a figure. Every number comes off lib/settled-log.ts, which comes off the
// Drop Log's own entries, which is splitOf()'s money and couponGapOf()'s pieces.

/**
 * How a row was finished, in the fewest words the line can carry.
 *
 * Said on the row rather than as a column, because the three are not variants of one fact: a payout
 * has a date and a party, a coupon night has a date and one person, and a taken drop has neither. A
 * column would have to be blank on two of them.
 */
function endedWith(row: SettledRecord): string | null {
  if (row.takenBy !== null) return `taken by ${row.takenBy}`;
  if (row.kind === "PIECES")
    return row.settledOn
      ? `settled with ${row.holderName} ${formatDropped(row.settledOn.slice(0, 10))}`
      : `settled with ${row.holderName}`;
  return row.settledOn ? `paid out ${formatDropped(row.settledOn.slice(0, 10))}` : "paid out";
}

/** The nights behind a fold, indented past the chevron the way the Drop Log's runs are. */
function SettledNights({
  records,
  bossByKey,
  partyById,
  id,
}: {
  records: SettledRecord[];
  bossByKey: Map<string, Boss>;
  partyById: Map<string, Party>;
  id: string;
}) {
  return (
    <ul className="droplog-runs" id={id}>
      {records.map((row) => {
        const boss = bossByKey.get(row.bossKey ?? "") ?? null;
        const party = partyById.get(row.partyId) ?? null;
        return (
          <li key={row.key} className="droplog-run">
            <Link href={`/bosses/parties/${row.partyId}`} className="loot-name">
              {boss ? bossLabel(boss.name, party?.difficulty ?? null) : "Unknown boss"}
            </Link>
            <span className="loot-meta">{formatDropped(row.droppedOn)}</span>
            {/* The same wrapper the Drop Log's runs put their figures in, so the counts line up down
                the right the way those do. */}
            <span className="droplog-amounts">
              <span className="droplog-take">{row.pieces}</span>
              <span className="loot-share-nets">coupons</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function SettledRow({
  line,
  bossByKey,
  partyById,
  busy,
  onUndo,
}: {
  line: SettledLine;
  bossByKey: Map<string, Boss>;
  partyById: Map<string, Party>;
  busy: boolean;
  onUndo: (settlementId: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const row = line.records[0]!;
  const boss = bossByKey.get(row.bossKey ?? "") ?? null;
  const party = partyById.get(row.partyId) ?? null;
  const panelId = `settled-nights-${line.key}`;
  const nights = `${line.records.length} nights`;
  // A fold stands for several nights, so it names what they have in common (the act) and counts the
  // rest. Naming one boss and one date would be naming one night out of five.
  const meta = line.folded
    ? [nights, endedWith(row)].filter(Boolean)
    : [
        boss ? bossLabel(boss.name, party?.difficulty ?? null) : null,
        formatDropped(row.droppedOn),
        row.sale?.seller
          ? `${row.sale.basis === "BOUGHT" ? "bought by" : "sold by"} ${row.sale.seller}`
          : null,
        endedWith(row),
      ].filter(Boolean);

  return (
    <li className={`droplog-row${open ? " is-open" : ""}`}>
      <div className="droplog-row-head">
        {line.folded ? (
          <button
            type="button"
            className="party-row-toggle"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((o) => !o)}
          >
            <span className="party-row-chevron" aria-hidden="true" />
            <span className="visually-hidden">{open ? `Hide ${nights}` : `Show ${nights}`}</span>
          </button>
        ) : (
          // The frame is kept so one row lines up with a folded one, as the Drop Log's does.
          <span className="party-row-toggle is-empty" aria-hidden="true" />
        )}

        {row.iconUrl ? (
          <img className="loot-icon" src={apiAssetUrl(row.iconUrl)} alt="" />
        ) : (
          <span className="loot-icon" aria-hidden="true" />
        )}

        <span className="droplog-title">
          {/* A fold's nights came off several parties, so its name links to none of them: it would
              open whichever happened to be first. The nights below carry the links. */}
          {line.folded ? (
            <span className="loot-name">{row.name}</span>
          ) : (
            <Link href={`/bosses/parties/${row.partyId}`} className="loot-name">
              {row.name}
              {row.quantity > 1 && <span className="loot-count"> x{row.quantity}</span>}
            </Link>
          )}
          <span className="loot-meta">{meta.join(" · ")}</span>
        </span>

        <span className="droplog-amounts">
          {row.kind === "MONEY" && row.sale?.pooled !== null && row.sale !== null ? (
            <>
              <span className="droplog-take">{formatMesos(row.sale.yourTake ?? 0, true)}</span>
              <span className="loot-share-nets">of {formatMesos(row.sale.pooled, true)}</span>
            </>
          ) : row.kind === "PIECES" ? (
            <>
              <span className="droplog-take">{line.pieces}</span>
              <span className="loot-share-nets">
                {/* A write-off is a decision, so it is said on the line it was made about, which for
                    a fold is the act that made it. */}
                {line.writtenOff > 0
                  ? `coupons, ${formatMesos(line.writtenOff, true)} written off`
                  : "coupons"}
              </span>
            </>
          ) : (
            <span className="loot-share-nets">nothing owed</span>
          )}
        </span>

        {/* The only act on this tab, and it is the act that put the row here, taken back off. A
            settled row is corrected by reopening it, which returns the night to the Settlement
            Ledger where every other correction already lives. */}
        {row.settlementId !== null && (
          <button
            type="button"
            className="link settled-reopen"
            disabled={busy}
            onClick={() => void onUndo(row.settlementId!)}
            aria-label={`Reopen ${row.name} settled with ${row.holderName}`}
          >
            Reopen
          </button>
        )}
      </div>

      {/* One act closed all of these, so Reopen above takes back all of them. The nights are here to
          be read, not acted on one at a time. */}
      {line.folded && open && (
        <SettledNights
          records={line.records}
          bossByKey={bossByKey}
          partyById={partyById}
          id={panelId}
        />
      )}
    </li>
  );
}

export function SettledView({
  rows,
  totals,
  orphans,
  bossByKey,
  partyById,
  busy,
  onUndo,
}: {
  rows: SettledRecord[];
  totals: SettledTotals;
  /** Settlements naming a drop the pool no longer has. Said, never absorbed. See orphansOf. */
  orphans: number;
  bossByKey: Map<string, Boss>;
  partyById: Map<string, Party>;
  busy: boolean;
  onUndo: (settlementId: string) => Promise<void>;
}) {
  if (rows.length === 0) {
    return <p className="party-hint">Nothing settled yet.</p>;
  }

  // The two kinds counted apart, because a coupon night and a sale do not add. Money is the one
  // figure that means the same thing across every basis: what there was to split.
  const counts = [
    totals.sales > 0 ? `${totals.sales} sold` : null,
    totals.nights > 0 ? `${totals.nights} settled` : null,
    totals.taken > 0 ? `${totals.taken} taken` : null,
  ].filter(Boolean);

  return (
    <section className="loot-pool">
      <header className="droplog-group-head">
        <h2 className="loot-pool-title">Settled</h2>
        <span className="droplog-group-total">
          {formatMesos(totals.pooled, true)}
          <span className="stat-label"> split</span>
        </span>
      </header>

      <p className="loot-meta settled-counts">
        {counts.join(" · ")}
        {totals.writtenOff > 0 && ` · ${formatMesos(totals.writtenOff, true)} written off`}
      </p>

      <ul className="droplog-list">
        {consolidateSettled(rows).map((line) => (
          <SettledRow
            key={line.key}
            line={line}
            bossByKey={bossByKey}
            partyById={partyById}
            busy={busy}
            onUndo={onUndo}
          />
        ))}
      </ul>

      {orphans > 0 && (
        <p className="loot-warn droplog-note">
          {orphans} {orphans === 1 ? "settlement names a drop" : "settlements name drops"} the pool
          no longer has, so {orphans === 1 ? "it is" : "they are"} not listed.
        </p>
      )}
    </section>
  );
}
