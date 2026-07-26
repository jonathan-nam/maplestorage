"use client";

import type { PartyMember } from "@/types/party";

// One seat in a party: their sprite when the lookup found one, and their name.
//
// The sprite is a Nexon-hosted URL, the same source the character carousel uses, so it is loaded
// directly rather than proxied. A seat with no sprite draws the frame empty rather than a
// placeholder face, which would be a portrait of somebody who is not them.
export function SeatChip({ member }: { member: PartyMember }) {
  return (
    <li
      className={`party-seat-chip${member.characterId ? " is-mine" : ""}`}
      title={member.characterId ? "One of your characters" : (member.personName ?? undefined)}
    >
      {member.spriteImgUrl ? (
        <img className="seat-sprite" src={member.spriteImgUrl} alt="" />
      ) : (
        <span className="seat-sprite" aria-hidden="true" />
      )}
      {member.name}
      {member.personName && <span className="party-person">{member.personName}</span>}
    </li>
  );
}
