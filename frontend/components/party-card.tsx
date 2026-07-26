"use client";

import Link from "next/link";
import { type ReactNode, useState } from "react";
import { RosterStrip } from "@/components/roster-strip";
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
export function PartyCard({
  party,
  heading,
  busy,
  onToggleClear,
}: {
  party: Party;
  heading: ReactNode;
  busy?: boolean;
  onToggleClear?: (cleared: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const rosterId = `party-roster-${party.id}`;
  const others = otherMembers(party);

  return (
    // Cleared rows step back so the list reads as what is left. Strictly `=== true`: null is "no
    // capture has said anything", which is a row that still needs an answer, not a finished one.
    <article
      className={`party-row${open ? " is-open" : ""}${party.cleared === true ? " is-cleared" : ""}`}
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
        {heading}
        <Link className="party-row-label" href={`/bosses/parties/${party.id}`}>
          {partySizeLabel(party.members.length)}
        </Link>

        {/* Only what needs doing. A settled pool says nothing, because a row that always shows
            "0 awaiting payout" is a row nobody reads. */}
        {(party.pendingLoot > 0 || party.awaitingPayout > 0) && (
          <Link className="party-loot-summary" href={`/bosses/parties/${party.id}`}>
            {[
              party.pendingLoot > 0 ? `${party.pendingLoot} in the pool` : null,
              party.awaitingPayout > 0 ? `${party.awaitingPayout} awaiting payout` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </Link>
        )}

        {/* The clear is boss_clear's own row, the one the matrix draws and a planner capture
            writes, so ticking it here and uploading a planner are two ways of saying the same
            thing. Three states, not two: nothing said this period, said and not done, done. */}
        {onToggleClear && (
          <button
            type="button"
            className={`party-clear is-${
              party.cleared === null ? "unseen" : party.cleared ? "cleared" : "pending"
            }`}
            disabled={busy}
            onClick={() => onToggleClear(!party.cleared)}
            title={
              party.cleared === null
                ? "No planner capture has mentioned this boss this period"
                : undefined
            }
          >
            {party.cleared === null ? "not reported" : party.cleared ? "cleared" : "not cleared"}
          </button>
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
