"use client";

import { Fragment, useEffect, useMemo, useState } from "react";

import { apiAssetUrl } from "@/lib/api";
import { BOSS_ART_2X } from "@/lib/boss-art";
import { bossLabel } from "@/lib/boss-difficulty";
import {
  formatDuration,
  type NightPerson,
  planAsText,
  planGrid,
  type RunTime,
  runTimes,
} from "@/lib/boss-night";
import {
  type Availability,
  type EligibleRun,
  movedTo,
  type OrderedPlan,
  type Plan,
  scheduleInOrder,
} from "@/lib/boss-run-plan";

/** Names as a person would say them: "Rinlow", "Rinlow and Kade", "Rinlow, Kade and Bel". */
function said(names: string[]): string {
  if (names.length < 2) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * "Rinlow is free at +3:00".
 *
 * The only sentence this page draws, and it is here because the alternative is worse: a schedule
 * that jumps from +2:50 to +3:00 with a twenty minute run above it is either a rounding error or a
 * wait, and nothing on the row says which.
 */
function waitLine(time: RunTime): string {
  const names = time.waitingFor.map((person) => person.name);
  if (names.length === 1) return `${names[0]} is free at ${time.at}`;
  return `${said(names)} are free at ${time.at}`;
}

/** What the plan is ordered against, and where a new order goes. Absent where it cannot be moved. */
export type Reorder = {
  /** The night, in minutes. */
  minutes: number;
  available: Record<string, Availability>;
  /** The run ids in their new order. */
  onChange: (ids: string[]) => void;
};

/**
 * Why a row cannot go there, or null when it can.
 *
 * A move that would break a window is refused rather than drawn with a warning on it, so the plan
 * on screen is always a night that can actually happen.
 */
function blockedBy(moved: OrderedPlan, roster: NightPerson[]): string | null {
  if (moved.plan !== null) return null;
  if (moved.overruns) return "The night is not long enough for that.";
  const names = moved.broken.map(
    (id) => roster.find((person) => person.id === id)?.name ?? "Somebody",
  );
  return `${said(names)} ${names.length === 1 ? "has" : "have"} to be gone before that.`;
}

/** One row's move in one direction: where it would leave the night, and what stops it. */
type Move = { order: EligibleRun[]; blocked: string | null };

/**
 * One arrow. Nothing happens on a blocked one, and hovering it says why.
 *
 * aria-disabled rather than disabled: a disabled button does not reliably take pointer events, and
 * the tooltip is the whole point of refusing a move rather than allowing it and marking it.
 */
function MoveArrow({
  move,
  way,
  boss,
  onChange,
}: {
  move: Move | null;
  way: "up" | "down";
  boss: string;
  onChange: (ids: string[]) => void;
}) {
  const allowed = move !== null && move.blocked === null;
  return (
    <button
      type="button"
      className="run-move-arrow"
      aria-disabled={!allowed}
      aria-label={`Move ${boss} ${way}`}
      title={move?.blocked ?? undefined}
      onClick={() => {
        if (allowed) onChange(move.order.map((run) => run.id));
      }}
    >
      <span aria-hidden="true">{way === "up" ? "▴" : "▾"}</span>
    </button>
  );
}

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
export function RunPlan({
  plan,
  roster,
  startAt,
  timed = true,
  reorder,
}: {
  plan: Plan;
  roster: NightPerson[];
  startAt: number;
  /** Off where the night is an order rather than a schedule: no times, no lengths, no waits. */
  timed?: boolean;
  reorder?: Reorder;
}) {
  const { people, rows } = planGrid(plan, roster);
  const times = timed ? runTimes(plan, roster, startAt) : [];

  // A row band alone answers "which boss", not "which person": the header sits rows away, so
  // reading a cell still means tracing a column by eye. CSS can do a row on its own and cannot do
  // a column, hence the state. Same reason the boss matrix carries one.
  const [hovered, setHovered] = useState<string | null>(null);

  // Each arrow knows what its own move would cost before it is pressed, which is what lets one be
  // refused with a reason instead of moving the row and then taking it back. Two schedules per run
  // of a night that is twenty runs at the outside.
  const moves = useMemo(() => {
    if (!reorder || plan.runs.length < 2) return null;
    const runs = plan.runs.map((planned) => planned.run);
    const options = { minutes: reorder.minutes, available: reorder.available };
    const to = (from: number, at: number) => {
      const order = movedTo(runs, from, at);
      return { order, blocked: blockedBy(scheduleInOrder(order, options), roster) };
    };
    return runs.map((_, row) => ({
      up: row === 0 ? null : to(row, row - 1),
      down: row === runs.length - 1 ? null : to(row, row + 1),
    }));
  }, [plan, reorder, roster]);

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
          {rows.map(({ planned, cells }, row) => {
            const time = times[row];
            return (
              <Fragment key={planned.run.id}>
                {time !== undefined && time.waitingFor.length > 0 && (
                  <tr className="run-wait">
                    <td colSpan={people.length + 1}>{waitLine(time)}</td>
                  </tr>
                )}
                {/* Striped from the row's own index rather than :nth-child, which counts the wait
                    rows above and flips the banding under every gap. */}
                <tr className={row % 2 === 1 ? "is-banded" : undefined}>
                  <th className="run-boss" scope="row">
                    {/* Flexed on an inner span: display:flex on a table cell takes it out of the
                    table layout and the columns stop aligning. */}
                    <span className="run-boss-inner">
                      {moves !== null && reorder !== undefined && (
                        <span className="run-move">
                          {(["up", "down"] as const).map((way) => (
                            <MoveArrow
                              key={way}
                              move={moves[row]?.[way] ?? null}
                              way={way}
                              boss={bossLabel(planned.run.bossName, planned.run.difficulty)}
                              onChange={reorder.onChange}
                            />
                          ))}
                        </span>
                      )}
                      {/* #188 took a running clock off this row for being arithmetic on a flat
                      half-hour placeholder. It is back because the night now has a start on the
                      reset clock, so this is a time the party can turn up for rather than a
                      distance from a button press. The tilde is the same objection, answered:
                      a time reached by adding up guesses is marked as one. */}
                      {time !== undefined && (
                        <span className="run-time">{time.approx ? `~${time.at}` : time.at}</span>
                      )}
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
                        {/* A tilde where nobody has timed this party, so a guessed half hour and a
                        measured one are not read as the same claim. */}
                        {timed && (
                          <span className="run-boss-minutes">
                            {`${planned.run.assumed ? "~" : ""}${formatDuration(planned.run.minutes)}`}
                          </span>
                        )}
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
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** The plan as text on the clipboard, which is where a party actually reads it. */
export function CopyPlan({
  plan,
  roster,
  startAt,
  timed = true,
}: {
  plan: Plan;
  roster: NightPerson[];
  startAt: number;
  timed?: boolean;
}) {
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
          ?.writeText(planAsText(plan, roster, startAt, timed))
          .then(() => setCopied(true))
          .catch(() => setCopied(false));
      }}
    >
      <span className="copy-value">{copied ? "Copied" : "Copy the order"}</span>
    </button>
  );
}
