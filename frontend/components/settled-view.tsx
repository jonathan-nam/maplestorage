"use client";

import Link from "next/link";
import { useState } from "react";
import { apiAssetUrl } from "@/lib/api";
import { bossLabel } from "@/lib/boss-difficulty";
import { formatMesos } from "@/lib/drop-split";
import { formatDropped } from "@/lib/loot";
import { consolidateSettled } from "@/lib/settled-log";
import type { SettledLine, SettledRecord, SettledTotals } from "@/lib/settled-log";
import type { DropLogTotals } from "@/lib/drop-log";
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
}: {
  line: SettledLine;
  bossByKey: Map<string, Boss>;
  partyById: Map<string, Party>;
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
      </div>

      {/* One act closed all of these. The nights are here to be read: nothing on this tab is acted
          on, one at a time or otherwise. */}
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

/**
 * What the whole log holds, which is NOT what this view's other figures count.
 *
 * Every other number on this page is off the settled rows. This one is off every drop there has
 * ever been, so it is stated on its own and named for the thing it counts rather than joined to the
 * counts line, where "60 drops · 3 settled" reads as two figures about one population.
 *
 * Drawn even when nothing is settled: it was the Drop Ledger's own heading, and a page that shows it
 * only once something else has happened would drop the count of an account that has logged drops and
 * settled none.
 */
function LoggedCount({ logged }: { logged: DropLogTotals }) {
  return (
    <p className="loot-meta settled-counts">
      {logged.drops} logged
      {/* Whichever happened. A Heroic account never sells one and an Interactive one never takes
          one, so in practice this is a single figure either way. */}
      {logged.sold > 0 || logged.taken === 0 ? ` · ${logged.sold} sold` : ""}
      {logged.taken > 0 ? ` · ${logged.taken} taken` : ""}
      {logged.pending > 0 ? ` · ${logged.pending} in the pool` : ""}
    </p>
  );
}

export function SettledView({
  rows,
  totals,
  logged,
  orphans,
  bossByKey,
  partyById,
}: {
  rows: SettledRecord[];
  totals: SettledTotals;
  /** The whole log's counts, which the Drop Ledger used to head itself with. See LoggedCount. */
  logged: DropLogTotals;
  /** Settlements naming a drop the pool no longer has. Said, never absorbed. See orphansOf. */
  orphans: number;
  bossByKey: Map<string, Boss>;
  partyById: Map<string, Party>;
}) {
  if (rows.length === 0) {
    return (
      <>
        <LoggedCount logged={logged} />
        <p className="party-hint">Nothing settled yet.</p>
      </>
    );
  }

  // The two kinds counted apart, because a coupon night and a sale do not add. Money is the one
  // figure that means the same thing across every basis: what there was to split.
  const counts = [
    totals.sales > 0 ? `${totals.sales} sold` : null,
    totals.nights > 0 ? `${totals.nights} settled` : null,
    totals.taken > 0 ? `${totals.taken} taken` : null,
  ].filter(Boolean);

  return (
    <>
      {/* Above the section, not inside it. Two lines in the same style under one heading read as two
          figures about the same rows, and these count different things: every drop there has been,
          against the ones that are finished. */}
      <LoggedCount logged={logged} />

      <section className="loot-pool">
        <header className="droplog-group-head">
          <h2 className="loot-pool-title">Settled</h2>
          <span className="droplog-group-total">
            {formatMesos(totals.pooled, true)}
            <span className="stat-label"> split</span>
            {/* Your share of it. The Drop Ledger totalled this per month, and stopped stating any meso
              when sale figures became this view's, so it arrived here with the rows behind it. Both
              figures carry the coupon lots too, which are on no row. See SettledTotals.pooled. */}
            {` · ${formatMesos(totals.yourTake, true)}`}
            <span className="stat-label"> your take</span>
          </span>
        </header>

        <p className="loot-meta settled-counts">
          {counts.join(" · ")}
          {totals.writtenOff > 0 && ` · ${formatMesos(totals.writtenOff, true)} written off`}
        </p>

        <ul className="droplog-list">
          {consolidateSettled(rows).map((line) => (
            <SettledRow key={line.key} line={line} bossByKey={bossByKey} partyById={partyById} />
          ))}
        </ul>

        {/* Money missing from the totals above, said where those totals are. It was the Drop Ledger's
          note until that page stopped stating a meso. Same shape as the orphan count below: an
          absence nothing says is the silent wrong number. */}
        {totals.unreadable > 0 && (
          <p className="loot-warn droplog-note">
            {totals.unreadable} sold{" "}
            {totals.unreadable === 1 ? "drop names a seat" : "drops name seats"} that has left, so{" "}
            {totals.unreadable === 1 ? "its split cannot" : "their splits cannot"} be read and{" "}
            {totals.unreadable === 1 ? "its" : "their"} money is in neither total above.
          </p>
        )}

        {orphans > 0 && (
          <p className="loot-warn droplog-note">
            {orphans} {orphans === 1 ? "settlement names a drop" : "settlements name drops"} the
            pool no longer has, so {orphans === 1 ? "it is" : "they are"} not listed.
          </p>
        )}
      </section>
    </>
  );
}
