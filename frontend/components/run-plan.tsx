"use client";

import { useEffect, useState } from "react";

import { apiAssetUrl } from "@/lib/api";
import { BOSS_ART_2X } from "@/lib/boss-art";
import { bossLabel } from "@/lib/boss-difficulty";
import { formatDuration, type NightPerson, planAsText, planGrid } from "@/lib/boss-night";
import type { Plan } from "@/lib/boss-run-plan";

/**
 * The night, in order: bosses down the rows, people across the columns.
 *
 * The cell is the character that person brings, or an X where they sit the run out. Both halves
 * matter once the group is bigger than a party, and a list of the seats in each run could only
 * ever show the first. See planGrid.
 *
 * A switch is the one coloured thing here, because it is the one thing the ordering exists to
 * minimise, and it is marked on the cell that moved rather than counted at the end of the row.
 */
export function RunPlan({ plan, roster }: { plan: Plan; roster: NightPerson[] }) {
  const { people, rows } = planGrid(plan, roster);

  // A row band alone answers "which boss", not "which person": the header sits rows away, so
  // reading a cell still means tracing a column by eye. CSS can do a row on its own and cannot do
  // a column, hence the state. Same reason the boss matrix carries one.
  const [hovered, setHovered] = useState<string | null>(null);

  return (
    // Cleared here rather than per cell, so leaving one cell for its neighbour does not blank the
    // band between the two events.
    <div className="run-grid" onMouseLeave={() => setHovered(null)}>
      <table className="run-table">
        <thead>
          <tr>
            <th className="run-col-head" scope="col">
              Boss
            </th>
            {people.map((person) => (
              <th
                key={person.id}
                className={
                  hovered === person.id ? "run-person-head is-col-hover" : "run-person-head"
                }
                scope="col"
                title={person.name}
                onMouseEnter={() => setHovered(person.id)}
              >
                {person.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ planned, cells }) => (
            <tr key={planned.run.id}>
              <th className="run-boss" scope="row">
                {/* Flexed on an inner span: display:flex on a table cell takes it out of the
                    table layout and the columns stop aligning. */}
                <span className="run-boss-inner">
                  {/* The position in the night, and not the minute it starts: that was arithmetic
                      on a flat half-hour placeholder, and #188 took it off the row. */}
                  <span className="run-number" aria-hidden="true" />
                  {BOSS_ART_2X[planned.run.bossKey] ? (
                    <img
                      className="run-art"
                      src={apiAssetUrl(BOSS_ART_2X[planned.run.bossKey] as string)}
                      alt=""
                      width={40}
                      height={40}
                    />
                  ) : (
                    <span className="run-art is-empty" aria-hidden="true" />
                  )}
                  <span className="run-boss-text">
                    <span className="run-boss-name">
                      {bossLabel(planned.run.bossName, planned.run.difficulty)}
                    </span>
                    <span className="run-boss-minutes">{formatDuration(planned.run.minutes)}</span>
                  </span>
                </span>
              </th>

              {cells.map((cell, i) => {
                const person = people[i] as NightPerson;
                const classes = ["run-cell"];
                if (cell.character === null) classes.push("is-out");
                if (cell.switched) classes.push("is-switch");
                if (hovered === person.id) classes.push("is-col-hover");
                return (
                  <td
                    key={person.id}
                    className={classes.join(" ")}
                    title={
                      cell.switched ? `${person.name} switches to ${cell.character}` : undefined
                    }
                    onMouseEnter={() => setHovered(person.id)}
                  >
                    {cell.character === null ? (
                      <>
                        <span aria-hidden="true">&#10005;</span>
                        <span className="visually-hidden">Not running</span>
                      </>
                    ) : (
                      <>
                        {cell.switched && (
                          <span className="run-swap" aria-hidden="true">
                            &#8644;{" "}
                          </span>
                        )}
                        {cell.character}
                      </>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The plan as text on the clipboard, which is where a party actually reads it. */
export function CopyPlan({ plan, roster }: { plan: Plan; roster: NightPerson[] }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1200);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      className={copied ? "copy-amount copied" : "copy-amount"}
      onClick={() => {
        navigator.clipboard
          ?.writeText(planAsText(plan, roster))
          .then(() => setCopied(true))
          .catch(() => setCopied(false));
      }}
    >
      <span className="copy-value">{copied ? "Copied" : "Copy the order"}</span>
    </button>
  );
}
