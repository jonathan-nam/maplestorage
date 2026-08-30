"use client";

import { useState } from "react";
import { spriteUrl } from "@/lib/api";
import { type PersonDraft, claim } from "@/lib/people-board";

// Only our own chips are accepted, so text dragged in from anywhere else is not read as a name.
const DRAG_TYPE = "application/x-character";

/**
 * Who plays which character, as the characters rather than as a list of names.
 *
 * A character moves by being dragged onto whoever plays them. The same move is a click on the chip
 * and then a click on the target, which is also the only way it works from the keyboard: the
 * targets are drawn as buttons for the length of the pickup and are not there otherwise.
 */
export function PeopleBoard({
  people,
  unassigned,
  hidden,
  showHidden,
  spriteFor,
  busy,
  onChange,
  onRename,
  onRemove,
  onShowHidden,
}: {
  people: PersonDraft[];
  unassigned: string[];
  /** One-off characters kept out of the pool, counted so the page does not quietly drop them. */
  hidden: number;
  showHidden: boolean;
  spriteFor: (name: string) => string | null;
  busy: boolean;
  onChange: (people: PersonDraft[]) => void;
  onRename: (index: number, name: string) => void;
  onRemove: (index: number) => void;
  onShowHidden: (show: boolean) => void;
}) {
  // The character being moved by clicks. Drags carry their own name on the dataTransfer, so this
  // stays null throughout one and the "give it to" buttons never appear mid-drag.
  const [picked, setPicked] = useState<string | null>(null);
  // Which zone the pointer is over, null being the pool. Undefined is no drag in progress.
  const [over, setOver] = useState<number | null | undefined>(undefined);

  function place(name: string, personIndex: number | null) {
    setPicked(null);
    setOver(undefined);
    onChange(claim(people, name, personIndex));
  }

  function zoneProps(personIndex: number | null) {
    return {
      className: `roster-strip person-chips${over !== undefined && over === personIndex ? " is-target" : ""}`,
      onDragOver: (e: React.DragEvent) => {
        if (busy || !e.dataTransfer.types.includes(DRAG_TYPE)) return;
        e.preventDefault();
        setOver(personIndex);
      },
      onDragLeave: () => setOver(undefined),
      onDrop: (e: React.DragEvent) => {
        const name = e.dataTransfer.getData(DRAG_TYPE);
        if (busy || name === "") return;
        e.preventDefault();
        place(name, personIndex);
      },
      // A pickup places on the next click anywhere in the zone, chips included: clicking a second
      // chip while holding one would otherwise swap what you are holding for no reason.
      onClick: () => {
        if (!busy && picked !== null) place(picked, personIndex);
      },
    };
  }

  return (
    <div className={`people-board${picked !== null ? " is-picking" : ""}`}>
      <div className="people-list">
        {people.map((row, index) => (
          // A saved person keys on their id; a new row has only its slot.
          <div className="person-row" key={row.id ?? `new-${index}`}>
            <input
              className="split-input person-name"
              value={row.name}
              onChange={(e) => onRename(index, e.target.value)}
              placeholder="Jared"
              aria-label="Person's name"
              maxLength={40}
            />
            <ul {...zoneProps(index)}>
              {row.characters.map((name) => (
                <Chip
                  key={name}
                  name={name}
                  sprite={spriteFor(name)}
                  picked={picked === name}
                  busy={busy}
                  onPick={() => setPicked(name)}
                />
              ))}
              {picked !== null && !row.characters.includes(picked) && (
                <Target
                  label={row.name.trim() === "" ? "This row" : row.name}
                  description={`Give ${picked} to ${row.name.trim() === "" ? "this row" : row.name}`}
                />
              )}
            </ul>
            <button
              type="button"
              className="party-delete"
              disabled={busy}
              onClick={() => onRemove(index)}
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      <h2 className="night-heading people-pool-title">Unassigned party members</h2>
      <ul {...zoneProps(null)}>
        {unassigned.map((name) => (
          <Chip
            key={name}
            name={name}
            sprite={spriteFor(name)}
            picked={picked === name}
            busy={busy}
            onPick={() => setPicked(name)}
          />
        ))}
        {picked !== null && !unassigned.includes(picked) && (
          <Target label="Unassign" description={`Take ${picked} off everybody`} />
        )}
      </ul>

      {(hidden > 0 || showHidden) && (
        <button
          type="button"
          className="party-cancel people-pool-more"
          onClick={() => onShowHidden(!showHidden)}
        >
          {showHidden ? "Hide one-offs" : `${hidden} one-off${hidden === 1 ? "" : "s"} hidden`}
        </button>
      )}
    </div>
  );
}

/** One character, at the size they are drawn everywhere else. See .roster-sprite. */
function Chip({
  name,
  sprite,
  picked,
  busy,
  onPick,
}: {
  name: string;
  sprite: string | null;
  picked: boolean;
  busy: boolean;
  onPick: () => void;
}) {
  return (
    <li className="roster-tile">
      <button
        type="button"
        className={`person-chip${picked ? " is-picked" : ""}`}
        draggable={!busy}
        aria-pressed={picked}
        disabled={busy}
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_TYPE, name);
          e.dataTransfer.effectAllowed = "move";
        }}
        onClick={onPick}
      >
        {sprite ? (
          <img className="roster-sprite" src={spriteUrl(sprite)} alt="" />
        ) : (
          // The lookup found nothing, or has not run. The frame is drawn anyway so a row of five
          // does not go ragged around the one character nobody could find.
          <span className="roster-sprite is-empty" aria-hidden="true" />
        )}
        <span className="roster-name">{name}</span>
      </button>
    </li>
  );
}

/**
 * Where the character you are holding can go, for the length of the pickup only.
 *
 * The zone around it takes the click, so this is a label that happens to be focusable rather than
 * a control of its own. It exists because a drop zone cannot be tabbed to.
 */
function Target({ label, description }: { label: string; description: string }) {
  return (
    <li className="roster-tile">
      <button type="button" className="person-chip person-target" aria-label={description}>
        <span className="roster-sprite is-empty" aria-hidden="true" />
        <span className="roster-name">{label}</span>
      </button>
    </li>
  );
}
