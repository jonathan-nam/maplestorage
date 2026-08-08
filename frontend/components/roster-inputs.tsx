"use client";

import { KNOWN_CHARACTERS_ID } from "@/components/known-characters";
import { MAX_PARTY } from "@/lib/parties";

// The OTHER seats in a party, as names you can type over. Your own character is the config, so it
// is not in here and the cap is one below the party limit.
//
// Shared by the edit page's per-character grid and by Party View's row. Seats are matched to
// existing rows by NAME (see writeMembers), so a typo does not rename a seat, it makes a new one
// and abandons the old: the datalist is what keeps that from happening, and both places get it.

/**
 * What each seat usually takes of a split, when a caller lets it be set.
 *
 * Positional with `members` rather than keyed by name, because a name is being typed: keyed by one,
 * a share would follow every keystroke to a new key and be lost on the way. `own` is your own
 * character's, whose seat is the config itself.
 *
 * Blank is one share, so a party that splits evenly is a row of empty boxes.
 */
export type SeatShares = {
  own: string;
  members: string[];
  onChange: (next: { own: string; members: string[] }) => void;
};

export function RosterInputs({
  members,
  onChange,
  shares,
  ownName,
}: {
  members: string[];
  onChange: (members: string[]) => void;
  /** Absent leaves the shares alone, which is every caller that is not editing the party itself. */
  shares?: SeatShares;
  /** Your own character, named beside its share box. Only read when `shares` is given. */
  ownName?: string;
}) {
  const shareBox = (name: string, value: string, set: (next: string) => void) => (
    <input
      className="split-input loot-count-input"
      value={value}
      onChange={(e) => set(e.target.value)}
      placeholder="1"
      aria-label={`Shares for ${name}`}
      inputMode="numeric"
      maxLength={2}
    />
  );

  return (
    <div className="config-members">
      {shares && ownName && (
        // Your own seat, so that "I take double" can be said standing rather than on every sale.
        // The name is the config and cannot be typed over, so it is text and not an input.
        <span className="config-member">
          <span className="config-own-name">{ownName}</span>
          {shareBox(ownName, shares.own, (own) =>
            shares.onChange({ own, members: shares.members }),
          )}
        </span>
      )}
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
          {shares &&
            shareBox(member || `member ${index + 1}`, shares.members[index] ?? "", (value) =>
              shares.onChange({
                own: shares.own,
                members: shares.members.map((s, i) => (i === index ? value : s)),
              }),
            )}
          {members.length > 1 && (
            <button
              type="button"
              className="grid-boss-remove"
              aria-label={`Remove member ${index + 1}`}
              onClick={() => {
                onChange(members.filter((_, i) => i !== index));
                // The share goes with the seat, or every later one shifts up onto the wrong person.
                shares?.onChange({
                  own: shares.own,
                  members: shares.members.filter((_, i) => i !== index),
                });
              }}
            >
              &times;
            </button>
          )}
        </span>
      ))}
      {members.length < MAX_PARTY - 1 && (
        <button
          type="button"
          className="party-add-seat"
          onClick={() => {
            onChange([...members, ""]);
            shares?.onChange({ own: shares.own, members: [...shares.members, ""] });
          }}
        >
          + Member
        </button>
      )}
    </div>
  );
}
