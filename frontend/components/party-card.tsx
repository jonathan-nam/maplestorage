"use client";

import Link from "next/link";
import { type ReactNode, useState } from "react";
import { RosterStrip } from "@/components/roster-strip";
import { clearStateLabel, nextClear } from "@/lib/boss-clears";
import { poolLabel } from "@/lib/loot";
import { otherMembers, partySizeLabel } from "@/lib/parties";
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
}) {
  const [open, setOpen] = useState(false);
  const pool = poolLabel(party);
  const rosterId = `party-roster-${party.id}`;
  const others = otherMembers(party);

  return (
    // Cleared rows step back so the list reads as what is left. Strictly `=== true`: null is "no
    // capture has said anything", which is a row that still needs an answer, not a finished one.
    <article
      className={`party-row${open ? " is-open" : ""}${clear.cleared === true ? " is-cleared" : ""}`}
    >
      <header className="party-row-head">
        {/* A disclosure of its own rather than the whole header, which already holds two links and
            the clear button: nesting those inside a control is not something a row can do. Absent
            for a solo config, where there is no roster to open. */}
        {others.length > 0 ? (
          <button
            type="button"
            className="party-row-toggle"
            aria-expanded={open}
            aria-controls={rosterId}
            onClick={() => setOpen((o) => !o)}
          >
            <span className="party-row-chevron" aria-hidden="true" />
            <span className="visually-hidden">
              {open ? "Hide who is in this party" : "Show who is in this party"}
            </span>
          </button>
        ) : (
          // The frame is kept so a solo row's heading still lines up with its neighbours'.
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

      {/* The others only. Your own character is what the row is about, named in the heading or in
          the group above it, and drawing it again in every row is a column of the same sprite.
          Unmounted rather than hidden when closed: a display:none roster is still focusable. */}
      {open && others.length > 0 && (
        <div id={rosterId}>
          <RosterStrip members={others} />
        </div>
      )}
    </article>
  );
}
