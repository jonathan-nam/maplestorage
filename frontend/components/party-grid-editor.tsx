"use client";

import { useState } from "react";
import { apiAssetUrl } from "@/lib/api";
import {
  type Draft,
  type DraftCell,
  draftProblem,
  filledCells,
  knownIgn,
  MAX_PARTY,
  newKey,
  toDraft,
  toSaveBody,
} from "@/lib/party-grid";
import type { Boss } from "@/types/boss";
import type { PartyGrid, SaveGridBody } from "@/types/party";

// The roster, edited as the sheet it replaces: a column per person, a row per party, and the
// character they bring in the cell. Blank cell means they sat that one out.
//
// One editing surface for the whole grid, saved in one request, because a per-row save would make
// "add a column" mean N requests that can half-fail.

const EMPTY: DraftCell = { label: "", ign: "" };

export function PartyGridEditor({
  grid,
  bosses,
  busy,
  error,
  onSave,
}: {
  grid: PartyGrid;
  bosses: Boss[];
  busy: boolean;
  error: string | null;
  onSave: (body: SaveGridBody) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(grid));
  const [dirty, setDirty] = useState(false);

  const edit = (next: Draft) => {
    setDraft(next);
    setDirty(true);
  };

  const problem = draftProblem(draft);
  const bossByKey = new Map(bosses.map((b) => [b.bossKey, b]));

  const setCell = (rowKey: string, personKey: string, cell: DraftCell) =>
    edit({
      ...draft,
      rows: draft.rows.map((r) =>
        r.key === rowKey ? { ...r, cells: { ...r.cells, [personKey]: cell } } : r,
      ),
    });

  // Typing a label this person has used elsewhere brings its IGN with it: "lynn" is acornacorn in
  // every row, and typing that twice is how the two rows end up disagreeing.
  const fillIgn = (rowKey: string, personKey: string, cell: DraftCell) => {
    if (cell.ign.trim() !== "" || cell.label.trim() === "") return;
    const known = knownIgn(draft, personKey, cell.label);
    if (known !== "") setCell(rowKey, personKey, { ...cell, ign: known });
  };

  return (
    <section className="grid-editor">
      <div className="grid-scroll">
        <table className="grid-table">
          <thead>
            <tr>
              <th className="grid-row-head">Party</th>
              {draft.people.map((person) => (
                <th key={person.key} className="grid-col-head">
                  <input
                    className="split-input grid-person-name"
                    value={person.name}
                    onChange={(e) =>
                      edit({
                        ...draft,
                        people: draft.people.map((p) =>
                          p.key === person.key ? { ...p, name: e.target.value } : p,
                        ),
                      })
                    }
                    placeholder="who"
                    aria-label="Person's name"
                  />
                  <label className="grid-mvp">
                    <input
                      type="checkbox"
                      checked={person.mvp}
                      onChange={(e) =>
                        edit({
                          ...draft,
                          people: draft.people.map((p) =>
                            p.key === person.key ? { ...p, mvp: e.target.checked } : p,
                          ),
                        })
                      }
                    />
                    {/* The Auction House takes 3% from MVP and 5% from everyone else, and it is the
                        RECEIVING person's rate that applies to a payout. See lib/drop-split.ts. */}
                    <span>MVP</span>
                  </label>
                  <button
                    type="button"
                    className="grid-drop"
                    aria-label={`Remove ${person.name || "person"}`}
                    onClick={() =>
                      edit({
                        ...draft,
                        people: draft.people.filter((p) => p.key !== person.key),
                        // Their cells go with the column, or the next save would send seats for a
                        // person who is no longer in the grid.
                        rows: draft.rows.map((r) => {
                          const cells = { ...r.cells };
                          delete cells[person.key];
                          return { ...r, cells };
                        }),
                      })
                    }
                  >
                    &times;
                  </button>
                </th>
              ))}
              <th className="grid-add-col">
                <button
                  type="button"
                  className="party-add-seat"
                  onClick={() =>
                    edit({
                      ...draft,
                      people: [
                        ...draft.people,
                        { key: newKey("person", draft.people), name: "", mvp: false },
                      ],
                    })
                  }
                >
                  + Person
                </button>
              </th>
            </tr>
          </thead>

          <tbody>
            {draft.rows.map((row) => (
              <tr key={row.key}>
                <th className="grid-row-head" scope="row">
                  <input
                    className="split-input grid-row-name"
                    value={row.name}
                    onChange={(e) =>
                      edit({
                        ...draft,
                        rows: draft.rows.map((r) =>
                          r.key === row.key ? { ...r, name: e.target.value } : r,
                        ),
                      })
                    }
                    placeholder="Xkalos duo"
                    aria-label="Party name"
                  />
                  <details className="grid-bosses">
                    <summary>
                      {row.bossKeys.length === 0
                        ? "pick bosses"
                        : row.bossKeys.map((key) => {
                            const boss = bossByKey.get(key);
                            return boss?.iconUrl ? (
                              <img
                                key={key}
                                className="boss-portrait is-small"
                                src={apiAssetUrl(boss.iconUrl)}
                                alt={boss.name}
                                title={boss.name}
                              />
                            ) : (
                              <span key={key}>{boss?.name ?? key}</span>
                            );
                          })}
                    </summary>
                    <div className="grid-boss-picker">
                      {bosses.map((boss) => (
                        <label key={boss.bossKey} className="party-boss-chip">
                          <input
                            type="checkbox"
                            checked={row.bossKeys.includes(boss.bossKey)}
                            onChange={() =>
                              edit({
                                ...draft,
                                rows: draft.rows.map((r) =>
                                  r.key === row.key
                                    ? {
                                        ...r,
                                        bossKeys: r.bossKeys.includes(boss.bossKey)
                                          ? r.bossKeys.filter((k) => k !== boss.bossKey)
                                          : [...r.bossKeys, boss.bossKey],
                                      }
                                    : r,
                                ),
                              })
                            }
                          />
                          <span>{boss.name}</span>
                        </label>
                      ))}
                    </div>
                  </details>
                  <button
                    type="button"
                    className="grid-drop"
                    aria-label={`Remove ${row.name || "party"}`}
                    onClick={() =>
                      edit({ ...draft, rows: draft.rows.filter((r) => r.key !== row.key) })
                    }
                  >
                    &times;
                  </button>
                </th>

                {draft.people.map((person) => {
                  const cell = row.cells[person.key] ?? EMPTY;
                  return (
                    <td key={person.key} className="grid-cell">
                      <input
                        className="split-input grid-cell-label"
                        value={cell.label}
                        onChange={(e) =>
                          setCell(row.key, person.key, { ...cell, label: e.target.value })
                        }
                        onBlur={() => fillIgn(row.key, person.key, cell)}
                        placeholder="x"
                        aria-label={`${person.name || "person"} in ${row.name || "party"}`}
                      />
                      {/* Only once there is something to name. The label is often a class ("2nd
                          mech"), and a sprite lookup needs the character it stands for. */}
                      {cell.label.trim() !== "" && (
                        <input
                          className="split-input grid-cell-ign"
                          value={cell.ign}
                          onChange={(e) =>
                            setCell(row.key, person.key, { ...cell, ign: e.target.value })
                          }
                          placeholder="IGN"
                          aria-label={`In-game name for ${cell.label}`}
                        />
                      )}
                    </td>
                  );
                })}
                <td className="grid-cell is-spacer" />
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid-actions">
        <button
          type="button"
          className="party-add-seat"
          onClick={() =>
            edit({
              ...draft,
              rows: [
                ...draft.rows,
                { key: newKey("row", draft.rows), name: "", bossKeys: [], cells: {} },
              ],
            })
          }
        >
          + Party
        </button>
        <button
          type="button"
          className="party-save"
          disabled={busy || !dirty || problem !== null}
          onClick={() => onSave(toSaveBody(draft))}
        >
          {busy ? "Saving..." : "Save grid"}
        </button>
        {dirty && (
          <button
            type="button"
            className="party-cancel"
            disabled={busy}
            onClick={() => {
              setDraft(toDraft(grid));
              setDirty(false);
            }}
          >
            Revert
          </button>
        )}
        {/* The client's own refusal, in the server's words. The server checks again either way. */}
        {problem && <span className="grid-problem">{problem}</span>}
        {error && <span className="split-error">{error}</span>}
        <span className="party-hint">
          A blank cell means they sat that one out. {MAX_PARTY} to a party.
        </span>
      </div>

      <p className="party-hint">
        {draft.rows.length} parties, {draft.people.length} people,{" "}
        {draft.rows.reduce((sum, r) => sum + filledCells(r).length, 0)} seats.
      </p>
    </section>
  );
}
