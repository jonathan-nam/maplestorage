"use client";

import Link from "next/link";
import { type ReactNode, useState } from "react";
import { DropPicker } from "@/components/drop-picker";
import { RosterStrip } from "@/components/roster-strip";
import { clearStateLabel, nextClear } from "@/lib/boss-clears";
import { poolLabel } from "@/lib/loot";
import { otherMembers, partySizeLabel } from "@/lib/parties";
import type { BossDrop } from "@/types/drop";
import type { AddLootBody } from "@/types/loot";
import type { Party } from "@/types/party";

// One config, read only: who this character runs this boss with, and what its pool is up to.
// Editing lives on /bosses/parties/edit, because a config edited in two places is a config that
// can be edited into two different shapes.
//
// ONE line by default. The heading, the party size and the clear state answer "what is left to do
// this week", and that is what the list is scanned for; a character with a dozen bosses was a dozen
// rows of sprites to scroll past to find out. The roster is a click away rather than gone, because
// who you are running it with is the next question, not the first.
//
// The heading is passed in because it differs per view: the boss when filed by character, the
// character when filed by boss.
/** Named once so the button and the read-only span cannot word the three states apart. */
function clearClass(cleared: boolean | null): string {
  return cleared === null ? "unseen" : cleared ? "cleared" : "pending";
}

export function PartyCard({
  party,
  heading,
  busy,
  clear,
  onToggleClear,
  dropTable,
  onAddDrop,
}: {
  party: Party;
  heading: ReactNode;
  busy?: boolean;
  /**
   * The clear to draw, which is NOT always the config's own.
   *
   * On the live view it is party.cleared. On a past week the caller reads it out of that week's
   * clears instead, because /api/parties only ever answers for the period it is in. The card
   * takes it rather than reaching for party.cleared itself, so it cannot quietly draw this week's
   * state under last week's label.
   */
  clear: { cleared: boolean | null; byHand: boolean };
  /** Omitted for a read-only row: a past week is shown, not edited. */
  onToggleClear?: (cleared: boolean) => void;
  /** This party's boss's drop table, for the picker in the panel. */
  dropTable?: BossDrop[];
  /**
   * Omitted where a drop may not be added, which is any past week: the server stamps a drop with
   * today, so adding one under last week's label would file it in a week the screen is not showing.
   * Must reject when the add fails, so the row can say so.
   */
  onAddDrop?: (body: AddLootBody) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const pool = poolLabel(party);
  const panelId = `party-panel-${party.id}`;
  const others = otherMembers(party);
  // A solo party has no roster, but it does have a pool, so it opens too now.
  const opens = others.length > 0 || Boolean(onAddDrop);
  // Both, because `open` outlives `opens`: stepping to a past week takes the picker off a solo
  // row, and an is-open row with nothing under it is a gap below one line.
  const expanded = open && opens;

  return (
    // Cleared rows step back so the list reads as what is left. Strictly `=== true`: null is "no
    // capture has said anything", which is a row that still needs an answer, not a finished one.
    <article
      className={`party-row${expanded ? " is-open" : ""}${
        clear.cleared === true ? " is-cleared" : ""
      }`}
    >
      <header className="party-row-head">
        {/* A disclosure of its own rather than the whole header, which already holds two links and
            the clear button: nesting those inside a control is not something a row can do. Absent
            on a past week for a solo config, where the panel would hold nothing at all.

            The label stopped naming the roster when the drop picker joined it below. */}
        {opens ? (
          <button
            type="button"
            className="party-row-toggle"
            aria-expanded={open}
            aria-controls={panelId}
            // Closing drops a failed add's message with it. Kept, it would greet the next open
            // still claiming a save that is no longer being attempted.
            onClick={() => {
              setOpen((o) => !o);
              setAddError(null);
            }}
          >
            <span className="party-row-chevron" aria-hidden="true" />
            <span className="visually-hidden">{open ? "Hide this party" : "Show this party"}</span>
          </button>
        ) : (
          // The frame is kept so the row's heading still lines up with its neighbours'.
          <span className="party-row-toggle is-empty" aria-hidden="true" />
        )}
        {/* The name is the way into the party, in every grouping. It used to be plain text, which
            left a party with an empty pool reachable only by clicking the word "Duo": the badge
            below is absent until something drops, and that is exactly when you go looking for
            where to add one. Filed by party the boss chip already does this job. */}
        <Link className="party-row-heading" href={`/bosses/parties/${party.id}`}>
          {heading}
        </Link>
        <span className="party-row-label">{partySizeLabel(party.members.length)}</span>

        {/* Work to do gets the line; a settled pool gets it quietly when there is none. It used
            to say nothing at all once everything was paid, which erased the pool from the row and
            left no way to tell a party with a season of drops from one that never dropped. */}
        {pool && (
          <Link
            className={pool.done ? "party-loot-summary is-done" : "party-loot-summary"}
            href={`/bosses/parties/${party.id}`}
          >
            {pool.text}
          </Link>
        )}

        {/* The clear is boss_clear's own row, the one the matrix draws and a planner capture
            writes, so ticking it here and uploading a planner are two ways of saying the same
            thing. Three states, not two: nothing said this period, said and not done, done.

            Without a handler it is still SHOWN, just not a control. A past week has an answer
            worth reading; what it does not have is one you may change from here. */}
        {onToggleClear ? (
          <button
            type="button"
            className={`party-clear is-${clearClass(clear.cleared)}`}
            disabled={busy}
            onClick={() => onToggleClear(nextClear(clear.cleared))}
            title={
              clear.cleared === null
                ? "No planner capture has mentioned this boss this period"
                : undefined
            }
          >
            {clearStateLabel(clear.cleared)}
          </button>
        ) : (
          <span className={`party-clear is-${clearClass(clear.cleared)} is-readonly`}>
            {clearStateLabel(clear.cleared)}
          </span>
        )}
      </header>

      {/* Who it is, and what it dropped, without leaving the list: logging a night used to be a
          page load per boss. Unmounted rather than hidden when closed, because a display:none
          panel is still focusable.

          The roster is the others only. Your own character is what the row is about, named in the
          heading or in the group above it, and drawing it again in every row is a column of the
          same sprite. */}
      {expanded && (
        <div id={panelId} className="party-row-panel">
          {others.length > 0 && <RosterStrip members={others} />}
          {onAddDrop && (
            <>
              <DropPicker
                party={party}
                table={dropTable}
                busy={busy ?? false}
                onAdd={async (body) => {
                  setAddError(null);
                  try {
                    await onAddDrop(body);
                  } catch (e) {
                    setAddError("That didn't save.");
                    // Rethrown so the picker keeps what was chosen, ready to try again.
                    throw e;
                  }
                }}
              />
              {/* Beside the picker, so it cannot outlive the control it is about. */}
              {addError && <p className="split-error">{addError}</p>}
            </>
          )}
        </div>
      )}
    </article>
  );
}
