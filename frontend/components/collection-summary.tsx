"use client";

import { CopyAmount } from "@/components/copy-amount";
import type { Collection, CollectionTotals } from "@/lib/collection";
import { formatMesos } from "@/lib/drop-split";

// The account's position, above the cards: three totals and then one line per person.
//
// The cards below say all of this and more, and they are TALL: each carries its parts, its shares,
// its pieces and two boxes, so three people is already more than a screen. "What do I owe and what
// am I owed" was a question you had to scroll to answer, which is what the Wallet page answered
// before this tab absorbed it.
//
// Every figure here is summed off the CARDS. The Wallet had its own pass over the pools, which is
// how two surfaces come to give two answers, and a strip disagreeing with the list under it would be
// the same bug with a shorter walk between the two halves.

/** One line of the strip: a person and where the two of you stand. */
type Line = { key: string; name: string; net: number };

export function CollectionSummary({
  rows,
  totals,
}: {
  rows: Collection[];
  totals: CollectionTotals;
}) {
  if (rows.length === 0) return null;

  // Biggest first, either way, so the relationship worth looking at is at the top whichever
  // direction it runs. The name breaks a tie, so two reads never disagree.
  const lines: Line[] = rows
    .map((row) => ({ key: row.key, name: row.name, net: row.mesos - row.owedByYou }))
    .filter((line) => line.net !== 0)
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net) || a.name.localeCompare(b.name));

  return (
    <>
      <div className="stat-row">
        <div className="stat-tile">
          <span className="stat-label">You&apos;re owed</span>
          <span className="stat-value is-good">{formatMesos(totals.owed, true)}</span>
          <span className="stat-note">
            {`across ${totals.people} ${totals.people === 1 ? "person" : "people"}`}
          </span>
        </div>
        <div className="stat-tile">
          <span className="stat-label">You owe</span>
          <span className="stat-value">{formatMesos(totals.owe, true)}</span>
          <span className="stat-note">not collectable, said anyway</span>
        </div>
        <div className="stat-tile">
          <span className="stat-label">Net</span>
          <span className={totals.net < 0 ? "stat-value is-warn" : "stat-value is-good"}>
            {formatMesos(totals.net, true)}
          </span>
          <span className="stat-note">
            {totals.net < 0 ? "you are behind overall" : "yours to collect overall"}
          </span>
        </div>
      </div>

      {/* One line per person, which is the half the three tiles cannot say: a net of zero across two
          people who owe each other billions is the same tile as two people who owe nothing. */}
      {lines.length > 0 && (
        <ul className="collection-strip">
          {lines.map((line) => (
            <li key={line.key}>
              <span className="loot-share-name">{line.name}</span>
              {/* Signed, the way every figure on this tab is: the sign says which way it runs and
                  the colour is spent on outstanding-against-settled. Copyable, because this is the
                  number that gets pasted into the game's trade box. */}
              <CopyAmount
                value={Math.abs(line.net)}
                display={`${line.net > 0 ? "+" : "-"}${formatMesos(Math.abs(line.net), true)}`}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
