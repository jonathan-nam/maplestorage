"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { RosterStrip } from "@/components/roster-strip";
import { otherMembers, partyLabel, partySizeLabel } from "@/lib/parties";
import type { Party } from "@/types/party";

// One config, read only: who this character runs this boss with, and what its pool is up to.
// Editing lives on /bosses/parties/edit, because a config edited in two places is a config that
// can be edited into two different shapes.
//
// Two lines, and it took three: whatever the row is filed under, then the clear state, then the
// characters. The heading is passed in because it differs per view (the boss when filed by
// character, the character when filed by boss), and it shares its line with everything else that
// is one word long.
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
  return (
    <article className="party-row">
      <header className="party-row-head">
        {heading}
        <Link className="party-row-label" href={`/bosses/parties/${party.id}`}>
          {partyLabel(party)}
        </Link>
        <span className="party-card-size">{partySizeLabel(party.members.length)}</span>

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
                : party.clearedByHand
                  ? "Ticked here, not read off a planner"
                  : "Read off a planner capture"
            }
          >
            {party.cleared === null ? "not reported" : party.cleared ? "cleared" : "not cleared"}
            {party.cleared !== null && party.clearedByHand && (
              <span className="party-clear-hand"> by hand</span>
            )}
          </button>
        )}
      </header>

      {/* The others only. Your own character is what the row is about, named in the heading or in
          the group above it, and drawing it again in every row is a column of the same sprite. */}
      <RosterStrip members={otherMembers(party)} />
    </article>
  );
}
