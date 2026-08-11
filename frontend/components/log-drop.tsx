"use client";

import { useState } from "react";
import { DropPicker } from "@/components/drop-picker";
import type { Boss } from "@/types/boss";
import type { Character } from "@/types/character";
import type { DropTables } from "@/types/drop";
import type { LogDropBody } from "@/types/loot";

// The Drop Log's own form: whose character, which boss, what fell.
//
// EVERY boss is offered. It used to list only the ones that character had no party for, on the
// grounds that a partied boss's drops belong on the party. That is where they end up either way,
// because `poolFor` resolves the character's existing config when there is one and opens a solo
// config only when there is not (see logDropRoute), so the filter never prevented a wrong row. What
// it did was hide the obvious place to record a drop behind a rule nobody could see, leaving the
// bosses you run with somebody looking absent from a list of bosses.
//
// The pool is still not asked for or sent. A boss may have no pool at all yet, and which one it is
// follows from the character and the boss.

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

  const chosen = bosses.some((b) => b.bossKey === bossKey) ? bossKey : "";

  return (
    <section className="loot-pool add-panel">
      <h2 className="loot-pool-title">Add Drop</h2>

      <DropPicker
        bossKey={chosen}
        worldType={character.worldType}
        table={dropTables[chosen]}
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
              value={chosen}
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
            quantity: body.quantity,
          })
        }
      />
    </section>
  );
}
