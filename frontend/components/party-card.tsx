"use client";

import Link from "next/link";
import { otherMembers, partyLabel, partySizeLabel } from "@/lib/parties";
import type { Party } from "@/types/party";

// One config, read only: who this character runs this boss with, and what its pool is up to.
// Editing lives on /bosses/parties/edit, because a config edited in two places is a config that
// can be edited into two different shapes.
export function PartyCard({ party }: { party: Party }) {
  const others = otherMembers(party);

  return (
    <article className="party-card">
      <header className="party-card-head">
        <h3 className="party-card-name">
          <Link href={`/bosses/parties/${party.id}`}>{partyLabel(party)}</Link>
        </h3>
        <span className="party-card-size">{partySizeLabel(party.members.length)}</span>
      </header>

      <ul className="party-roster">
        {others.map((member) => (
          <li
            key={member.id}
            className="party-seat-chip"
            title={member.personName ? `${member.personName}'s character` : undefined}
          >
            {member.spriteImgUrl ? (
              <img className="seat-sprite" src={member.spriteImgUrl} alt="" />
            ) : (
              <span className="seat-sprite" aria-hidden="true" />
            )}
            {member.name}
            {member.personName && <span className="party-person">{member.personName}</span>}
          </li>
        ))}
      </ul>

      {/* Only what needs doing. A settled pool says nothing, because a card that always shows
          "0 awaiting payout" is a card nobody reads. */}
      {(party.pendingLoot > 0 || party.awaitingPayout > 0) && (
        <p className="party-loot-summary">
          {[
            party.pendingLoot > 0 ? `${party.pendingLoot} in the pool` : null,
            party.awaitingPayout > 0 ? `${party.awaitingPayout} awaiting payout` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
    </article>
  );
}
