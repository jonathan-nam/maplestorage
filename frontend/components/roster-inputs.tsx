"use client";

import { KNOWN_CHARACTERS_ID } from "@/components/known-characters";
import { MAX_PARTY } from "@/lib/parties";

// The OTHER seats in a party, as names you can type over. Your own character is the config, so it
// is not in here and the cap is one below the party limit.
//
// Shared by the edit page's per-character grid and by Party View's row. Seats are matched to
// existing rows by NAME (see writeMembers), so a typo does not rename a seat, it makes a new one
// and abandons the old: the datalist is what keeps that from happening, and both places get it.
export function RosterInputs({
  members,
  onChange,
}: {
  members: string[];
  onChange: (members: string[]) => void;
}) {
  return (
    <div className="config-members">
      {members.map((member, index) => (
        // Positions in a list of text: there is nothing else to key on until it is saved.
        <span className="config-member" key={index}>
          <input
            className="split-input"
            value={member}
            list={KNOWN_CHARACTERS_ID}
            onChange={(e) => onChange(members.map((m, i) => (i === index ? e.target.value : m)))}
            placeholder="character"
            aria-label={`Member ${index + 1}`}
            maxLength={40}
          />
          {members.length > 1 && (
            <button
              type="button"
              className="grid-boss-remove"
              aria-label={`Remove member ${index + 1}`}
              onClick={() => onChange(members.filter((_, i) => i !== index))}
            >
              &times;
            </button>
          )}
        </span>
      ))}
      {members.length < MAX_PARTY - 1 && (
        <button type="button" className="party-add-seat" onClick={() => onChange([...members, ""])}>
          + Member
        </button>
      )}
    </div>
  );
}
