"use client";

import { type ReactNode, useId, useState } from "react";
import { RosterStrip } from "@/components/roster-strip";
import { partySizeLabel } from "@/lib/parties";
import type { PartyMember } from "@/types/party";

// One arrangement in the by-party view: a character, whoever they run with, and the bosses they
// run together.
//
// Folded by default, for the reason PartyCard's rows are: the sprite strip is most of the row's
// height, and the header above it already names everyone on it. What never folds is the boss
// list, which carries the clears and the pools the page is scanned for.
export function ArrangementCard({
  sprite,
  name,
  /** The others, as the roster shows them. Your own character is the one the header names. */
  members,
  /** The bosses this arrangement runs. Outside the fold. */
  children,
}: {
  sprite?: string | null;
  name: string;
  members: PartyMember[];
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <article className={`boss-run${open ? " is-open" : ""}`}>
      <header className="boss-run-head">
        {/* A control of its own rather than the whole header, which holds a heading: a button may
            not have one inside it. Same chevron as the rows in the other two groupings. */}
        {members.length > 0 ? (
          <button
            type="button"
            className="party-row-toggle"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((o) => !o)}
          >
            <span className="party-row-chevron" aria-hidden="true" />
            <span className="visually-hidden">{open ? "Hide this party" : "Show this party"}</span>
          </button>
        ) : (
          // Nobody to show. The width is kept so the headings stay in one column.
          <span className="party-row-toggle is-empty" aria-hidden="true" />
        )}
        {sprite && <img className="seat-sprite is-large" src={sprite} alt="" />}
        <h3 className="boss-run-name">{name}</h3>
        <span className="party-card-size">{partySizeLabel(members.length + 1)}</span>
      </header>

      {/* Unmounted rather than hidden when closed, as PartyCard's panel is: a display:none strip
          is still focusable. */}
      {open && members.length > 0 && (
        <div id={panelId}>
          <RosterStrip members={members} />
        </div>
      )}

      {children}
    </article>
  );
}
