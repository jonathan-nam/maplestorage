"use client";

import { useMemo, useState } from "react";
import { DockShell } from "@/components/dock-shell";
import { apiAssetUrl } from "@/lib/api";
import {
  type CountRow,
  MAX_COUNT,
  changedCounts,
  openingValues,
  unreadable,
} from "@/lib/counts-editor";
import { useDockOpen } from "@/lib/use-dock-open";

// Typing what a character holds, item by item.
//
// The count is ABSOLUTE, the same figure a screenshot parse used to write, so re-typing one
// corrects it completely. The box is a number input, which means the stepper beside it IS the
// "+1 after a run" and needs no button of its own and no sentence explaining it.
//
// Every item in the catalog gets a row, not just the ones already held. An item you have none of
// is exactly the one you need to be able to enter, and it is the case a screenshot used to cover.

/** The order the sections appear in, matching the inventory window's own. */
const SECTION_ORDER = ["Eternal Pieces", "Symbols", "Consumables"] as const;
const OTHER = "Other";

function sectionsOf(rows: CountRow[]): [string, CountRow[]][] {
  const byGroup = new Map<string, CountRow[]>();
  for (const row of rows) {
    const group = row.itemGroup ?? OTHER;
    byGroup.set(group, [...(byGroup.get(group) ?? []), row]);
  }
  const known = SECTION_ORDER.filter((g) => byGroup.has(g)).map(
    (g) => [g, byGroup.get(g)!] as [string, CountRow[]],
  );
  // Anything whose group we do not recognise falls to the end rather than vanishing. An item you
  // cannot see is an item you will not notice is missing.
  const rest = [...byGroup.entries()].filter(
    ([g]) => !SECTION_ORDER.includes(g as (typeof SECTION_ORDER)[number]),
  );
  return [...known, ...rest];
}

export function CountsDock({
  characterName,
  rows,
  busy,
  onSave,
}: {
  /** Whose inventory is being typed, or null when no character is picked. */
  characterName: string | null;
  rows: CountRow[];
  busy: boolean;
  onSave: (changes: { tokenCatalogId: string; quantity: number }[]) => Promise<void>;
}) {
  const [open, setOpen] = useDockOpen("counts");
  // Read ONCE, at mount. The caller remounts this on a different character or a landed save (see
  // the key it passes), which is what resets the boxes.
  //
  // Not an effect on `rows`. That array is rebuilt on every render of the page above, so an effect
  // watching it fired on any unrelated state change and wiped what was being typed mid-word.
  const opening = useMemo(() => openingValues(rows), [rows]);
  const [typed, setTyped] = useState<Record<string, string>>(() => openingValues(rows));
  const [error, setError] = useState<string | null>(null);

  const changes = changedCounts(rows, typed);
  const bad = unreadable(typed);
  const sections = sectionsOf(rows);

  return (
    <DockShell name="counts" open={open} onOpenChange={setOpen}>
      {characterName === null ? (
        <p className="party-hint">Pick a character.</p>
      ) : (
        <>
          {sections.map(([group, items]) => (
            <section className="counts-section" key={group}>
              <h3 className="counts-section-head">{group}</h3>
              <div className="counts-rows">
                {items.map((item) => (
                  <label className="counts-row" key={item.tokenCatalogId}>
                    {item.iconUrl ? (
                      <img className="counts-icon" src={apiAssetUrl(item.iconUrl)} alt="" />
                    ) : (
                      // No art, which is every item newer than the pinned dataset. An empty frame
                      // keeps the rows aligned with the ones that have it.
                      <span className="counts-icon" aria-hidden="true" />
                    )}
                    <span className="counts-name">{item.name}</span>
                    <input
                      className="split-input counts-input"
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={MAX_COUNT}
                      value={typed[item.tokenCatalogId] ?? ""}
                      aria-label={`How many ${item.name} ${characterName} holds`}
                      disabled={busy}
                      onChange={(e) =>
                        setTyped({ ...typed, [item.tokenCatalogId]: e.target.value })
                      }
                    />
                  </label>
                ))}
              </div>
            </section>
          ))}

          {error && <p className="split-error">{error}</p>}

          {changes.length > 0 && bad.length === 0 && (
            <div className="loot-actions">
              <button
                type="button"
                className="party-save"
                disabled={busy}
                onClick={() => {
                  setError(null);
                  // Only the rows that differ. Every write stamps capturedAt, so re-sending an
                  // untouched figure would age-stamp the whole inventory as freshly answered for.
                  onSave(changes).catch(() => setError("Could not save those counts."));
                }}
              >
                Save
              </button>
              <button
                type="button"
                className="party-cancel"
                disabled={busy}
                onClick={() => {
                  setTyped(opening);
                  setError(null);
                }}
              >
                Revert
              </button>
            </div>
          )}
        </>
      )}
    </DockShell>
  );
}
