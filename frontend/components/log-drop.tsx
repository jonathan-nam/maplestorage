"use client";

import { useState } from "react";
import { DropPicker } from "@/components/drop-picker";
import type { Boss } from "@/types/boss";
import type { Character } from "@/types/character";
import type { DropTables } from "@/types/drop";
import type { LogDropBody } from "@/types/loot";

// The Drop Log's own form: whose character, which boss, what fell.
//
// The pool is not asked for and not sent. Which one a drop belongs in follows from the character
// and the boss, and the server resolves it (see logDropRoute), so a boss run alone can be logged
// here without a party existing for it first. That is the whole reason this form is not the loot
// pool's.

export function LogDrop({
  characters,
  bosses,
  dropTables,
  busy,
  onLog,
}: {
  characters: Character[];
  bosses: Boss[];
  dropTables: DropTables;
  busy: boolean;
  /** Rejecting keeps the picked drop on screen, so a refusal can be retried without re-picking. */
  onLog: (body: LogDropBody) => void | Promise<void>;
}) {
  const [characterId, setCharacterId] = useState(characters[0]?.id ?? "");
  const [bossKey, setBossKey] = useState("");

  // The roster can arrive after this mounts, and a character deleted from another tab can leave
  // the id pointing at nobody. Falling back to the first keeps the world the table is read against
  // a real one rather than a default nobody chose.
  const character = characters.find((c) => c.id === characterId) ?? characters[0];
  if (!character) return null;

  return (
    <DropPicker
      bossKey={bossKey}
      worldType={character.worldType}
      table={dropTables[bossKey]}
      boss={bosses.find((b) => b.bossKey === bossKey) ?? null}
      busy={busy}
      lead={
        <>
          {characters.length > 1 && (
            <select
              className="split-input"
              value={character.id}
              onChange={(e) => setCharacterId(e.target.value)}
              aria-label="Whose drop"
            >
              {characters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          <select
            className="split-input"
            value={bossKey}
            onChange={(e) => setBossKey(e.target.value)}
            aria-label="Which boss"
          >
            <option value="">pick a boss</option>
            {bosses.map((boss) => (
              <option key={boss.bossKey} value={boss.bossKey}>
                {boss.name}
              </option>
            ))}
          </select>
        </>
      }
      onAdd={(body) =>
        onLog({
          characterId: character.id,
          // Non-null by the time the picker submits: it refuses a body with no boss.
          bossKey: body.bossKey!,
          dropKey: body.dropKey,
          customName: body.customName,
        })
      }
    />
  );
}
