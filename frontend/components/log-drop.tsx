"use client";

import { useState } from "react";
import { DropPicker } from "@/components/drop-picker";
import { bossesWithoutParty } from "@/lib/parties";
import type { Boss } from "@/types/boss";
import type { Character } from "@/types/character";
import type { DropTables } from "@/types/drop";
import type { LogDropBody } from "@/types/loot";
import type { Party } from "@/types/party";

// The Drop Log's own form: whose character, which boss they solo, what fell.
//
// Bosses this character has a party for are not offered. Those drops belong to the party that ran
// it, and are logged on the party, which is also where they are sold and paid out. The server would
// file one here in the party's pool rather than a second one (see logDropRoute), so this is about
// there being one obvious place to log each drop, not about preventing a wrong row.
//
// The pool is still not asked for or sent. A boss run alone may have no pool at all yet, and which
// one it is follows from the character and the boss.

export function LogDrop({
  characters,
  parties,
  bosses,
  dropTables,
  busy,
  onLog,
}: {
  characters: Character[];
  /** Read with solo configs included, or every boss reads as unpartied. See bossesWithoutParty. */
  parties: Party[];
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

  const offered = bossesWithoutParty(parties, bosses, character.id);
  // Switching character can strip the boss that was picked, if the new one runs it with a party.
  // Held as unanswered rather than silently carried, which would post a drop against a boss the
  // list no longer shows.
  const chosen = offered.some((b) => b.bossKey === bossKey) ? bossKey : "";

  return (
    <section className="loot-pool">
      <h2 className="loot-pool-title">Solo drops</h2>

      <DropPicker
        bossKey={chosen}
        worldType={character.worldType}
        table={dropTables[chosen]}
        boss={offered.find((b) => b.bossKey === chosen) ?? null}
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
              {/* Says which bosses are on the list, where a bare "pick a boss" would leave the ones
                  with a party looking missing. */}
              <option value="">pick a boss you solo</option>
              {offered.map((boss) => (
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
    </section>
  );
}
