"use client";

import type { PartyMember } from "@/types/party";

// The people in a party, as the sprites they are.
//
// A row of names told you who was in it; a row of characters tells you at a glance, which is the
// whole reason the sprites were fetched. Same tile shape as the clear matrix's column heads, so a
// character reads the same on both pages.
export function RosterStrip({ members }: { members: PartyMember[] }) {
  return (
    <ul className="roster-strip">
      {members.map((member) => (
        <li key={member.id} className="roster-tile" title={member.personName ?? undefined}>
          {member.spriteImgUrl ? (
            <img className="roster-sprite" src={member.spriteImgUrl} alt="" />
          ) : (
            // The lookup found nothing, or has not run. The frame is drawn anyway so a party of
            // five does not go ragged around the one character nobody could find.
            <span className="roster-sprite is-empty" aria-hidden="true" />
          )}
          <span className="roster-name">{member.name}</span>
          {member.personName && <span className="roster-person">{member.personName}</span>}
        </li>
      ))}
    </ul>
  );
}
