"use client";

import { useState } from "react";
import { KNOWN_CHARACTERS_ID } from "@/components/known-characters";
import { difficultyLabel } from "@/lib/boss-difficulty";
import { bossesWithoutConfig } from "@/lib/parties";
import type { Boss } from "@/types/boss";
import type { Character } from "@/types/character";
import type { Party, SavePartyBody } from "@/types/party";

// A boss for this week and no other. The edit page makes STANDING parties, on this week and every
// week after, which is the wrong shape for a night somebody talks you into: it would be on the list
// for ever, and taking it off again is a second job.
//
// Closed by default. An open form above a list you came to read is a control explaining itself, and
// what this is for is said by the button that opens it.

export function AddForWeek({
  characters,
  bosses,
  parties,
  busy,
  error,
  onAdd,
}: {
  characters: Character[];
  bosses: Boss[];
  /** The period's configs, so a boss already on it is not offered twice. */
  parties: Party[];
  busy: boolean;
  error: string | null;
  onAdd: (body: SavePartyBody) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [characterId, setCharacterId] = useState("");
  const [bossKey, setBossKey] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [member, setMember] = useState("");

  // Opening on the first character rather than on a prompt to choose one, as the edit page does.
  const chosen = characterId || characters[0]?.id || "";
  const available = chosen ? bossesWithoutConfig(parties, bosses, chosen) : [];
  const difficulties = bosses.find((b) => b.bossKey === bossKey)?.difficulties ?? [];

  function reset() {
    setBossKey("");
    setDifficulty("");
    setMember("");
  }

  if (!open) {
    return (
      <div className="loot-actions">
        <button type="button" className="party-cancel" onClick={() => setOpen(true)}>
          Add for this week
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="loot-actions">
        <select
          className="split-input"
          value={chosen}
          aria-label="Character for the one-off"
          disabled={busy}
          onChange={(e) => {
            setCharacterId(e.target.value);
            // The bosses on offer are that character's, so a boss chosen for the last one is not
            // one this one can necessarily run.
            reset();
          }}
        >
          {characters.map((character) => (
            <option key={character.id} value={character.id}>
              {character.name}
            </option>
          ))}
        </select>

        <select
          className="split-input"
          value={bossKey}
          aria-label="Boss for the one-off"
          disabled={busy || available.length === 0}
          onChange={(e) => {
            setBossKey(e.target.value);
            setDifficulty("");
          }}
        >
          <option value="">
            {available.length === 0 ? "every boss is on this week" : "which boss..."}
          </option>
          {available.map((boss) => (
            <option key={boss.bossKey} value={boss.bossKey}>
              {boss.name}
            </option>
          ))}
        </select>

        {/* Empty stays a real answer here as it is on the edit page: a group that has not settled
            on a mode is not the same as one running Normal. */}
        <select
          className="split-input config-difficulty"
          value={difficulty}
          aria-label="Difficulty for the one-off"
          disabled={busy || difficulties.length === 0}
          onChange={(e) => setDifficulty(e.target.value)}
        >
          <option value="">difficulty...</option>
          {difficulties.map((d) => (
            <option key={d} value={d}>
              {difficultyLabel(d)}
            </option>
          ))}
        </select>

        <input
          className="split-input"
          value={member}
          list={KNOWN_CHARACTERS_ID}
          onChange={(e) => setMember(e.target.value)}
          placeholder="with who?"
          aria-label="First member of the one-off"
          maxLength={40}
          disabled={busy}
        />

        {/* The server refuses a party with nobody else in it, on purpose: that is a solo run. So
            there is no such thing as an empty one to fill in afterwards. */}
        <button
          type="button"
          className="party-save"
          disabled={busy || bossKey === "" || member.trim() === ""}
          onClick={async () => {
            await onAdd({
              characterId: chosen,
              bossKey,
              members: [member.trim()],
              difficulty: difficulty === "" ? null : difficulty,
              oneOff: true,
            });
            reset();
          }}
        >
          Add
        </button>

        <button
          type="button"
          className="party-cancel"
          disabled={busy}
          onClick={() => {
            setOpen(false);
            reset();
          }}
        >
          Cancel
        </button>
      </div>
      {error && <p className="split-error">{error}</p>}
    </>
  );
}
