"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useEffect, useState } from "react";
import { BossRoutineEditor } from "@/components/boss-routine-editor";
import { CharacterPicker } from "@/components/character-picker";
import { ApiError, apiFetch } from "@/lib/api";
import { peek, put } from "@/lib/cache";
import { preloadBossArt } from "@/lib/preload-boss-art";
import type { Boss, BossClearsView } from "@/types/boss";
import type { Character } from "@/types/character";
import type { Party } from "@/types/party";

type LoadState = "loading" | "loaded" | "error";

const BOSSES_KEY = "/api/bosses";
const CLEARS_KEY = "/api/bosses/clears";
const CHARACTERS_KEY = "/api/characters";
const PARTIES_KEY = "/api/parties";
const ROUTINE_KEY = "/api/bosses/routine";

// Which bosses each character runs, one character at a time.
//
// Its own page, and not a mode on the matrix. The matrix answers "what is left this week", which is
// a question about a period; this answers "what does this character run at all", which is not, and
// putting both on one grid meant a click whose meaning depended on state you could not see.
export default function BossRoutinePage() {
  // Before anything is fetched: see lib/preload-boss-art.ts.
  preloadBossArt();

  const { getToken } = useAuth();

  const [bosses, setBosses] = useState<Boss[]>(peek<Boss[]>(BOSSES_KEY) ?? []);
  const [characters, setCharacters] = useState<Character[]>(
    peek<Character[]>(CHARACTERS_KEY) ?? [],
  );
  const [parties, setParties] = useState<Party[]>(peek<Party[]>(PARTIES_KEY) ?? []);
  const [view, setView] = useState<BossClearsView | null>(peek<BossClearsView>(CLEARS_KEY) ?? null);
  const [state, setState] = useState<LoadState>("loading");
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // One token for the whole burst, as the matrix page does: getToken() can round-trip to Clerk
    // and that cost is paid before every request goes out.
    getToken()
      .then((token) => {
        const withToken = () => Promise.resolve(token);
        return Promise.all([
          apiFetch<Boss[]>(BOSSES_KEY, { method: "GET" }, withToken),
          apiFetch<Character[]>(CHARACTERS_KEY, { method: "GET" }, withToken),
          apiFetch<Party[]>(PARTIES_KEY, { method: "GET" }, withToken),
          apiFetch<BossClearsView>(CLEARS_KEY, { method: "GET" }, withToken),
        ]);
      })
      .then(([bossResult, characterResult, partyResult, viewResult]) => {
        setBosses(bossResult);
        setCharacters(characterResult);
        setParties(partyResult);
        setView(viewResult);
        put(BOSSES_KEY, bossResult);
        put(CHARACTERS_KEY, characterResult);
        put(PARTIES_KEY, partyResult);
        put(CLEARS_KEY, viewResult);
        // Open on the first character rather than on a prompt to choose one, like Edit parties.
        setSelected((current) => current ?? characterResult[0]?.id ?? null);
        setState("loaded");
      })
      .catch(() => setState((s) => (s === "loaded" ? "loaded" : "error")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const skipped = new Set(selected ? (view?.skipsByCharacter?.[selected] ?? []) : []);

  /**
   * Saves the whole routine, not the one box that changed.
   *
   * The set is what the server stores, so sending it entire keeps "unticked" meaning the same thing
   * on both sides. It also means a save that fails leaves nothing half-applied: the refusal below
   * puts the box back rather than leaving the page claiming something that was never written.
   */
  async function toggle(bossKey: string, runs: boolean) {
    if (!selected) return;
    const next = new Set(skipped);
    if (runs) next.delete(bossKey);
    else next.add(bossKey);

    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<BossClearsView>(
        ROUTINE_KEY,
        {
          method: "PUT",
          body: JSON.stringify({ characterId: selected, skippedBossKeys: Array.from(next) }),
        },
        getToken,
      );
      setView(result);
      put(CLEARS_KEY, result);
    } catch (e) {
      setError(e instanceof ApiError ? e.body : "Couldn't save that.");
    } finally {
      setBusy(false);
    }
  }

  const character = characters.find((c) => c.id === selected) ?? null;
  // A party config for this character and boss already says they run it, so the box is locked
  // rather than refused after the fact. See BossRoutineEditor.
  const lockedBossKeys = new Set(
    parties.filter((p) => p.characterId === selected).map((p) => p.bossKey),
  );

  return (
    <main className="page">
      <p className="loot-back">
        <Link href="/bosses">&larr; Individual View</Link>
      </p>
      <h1 className="page-title">Who runs what</h1>

      {state === "error" && <p>Couldn&apos;t load your bosses.</p>}
      {state === "loading" && <p className="party-hint">Loading...</p>}

      {state === "loaded" &&
        (characters.length === 0 ? (
          <p className="finder-empty">Add a character on the Inventory page first.</p>
        ) : (
          <>
            <CharacterPicker
              characters={characters}
              selectedId={selected}
              onSelect={(id) => {
                setSelected(id);
                setError(null);
              }}
            />

            {error && <p className="routine-error">{error}</p>}

            {character && (
              <BossRoutineEditor
                characterName={character.name}
                bosses={bosses}
                skipped={skipped}
                lockedBossKeys={lockedBossKeys}
                busy={busy}
                onToggle={toggle}
              />
            )}
          </>
        ))}
    </main>
  );
}
