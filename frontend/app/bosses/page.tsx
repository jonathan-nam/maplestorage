"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import { BossMatrix } from "@/components/boss-matrix";
import { apiFetch } from "@/lib/api";
import { peek, put } from "@/lib/cache";
import type { Boss, BossClearsByCharacter } from "@/types/boss";
import type { Character } from "@/types/character";

type LoadState = "loading" | "loaded" | "error";

const BOSSES_KEY = "/api/bosses";
const CLEARS_KEY = "/api/bosses/clears";
const CHARACTERS_KEY = "/api/characters";

export default function BossesPage() {
  const { getToken } = useAuth();

  // Seeded from cache so a repeat visit paints immediately rather than flashing a loading state
  // for data it already had. The fetch below still runs and overwrites. See lib/cache.ts.
  const seededBosses = peek<Boss[]>(BOSSES_KEY);
  const seededCharacters = peek<Character[]>(CHARACTERS_KEY);

  const [bosses, setBosses] = useState<Boss[]>(seededBosses ?? []);
  const [characters, setCharacters] = useState<Character[]>(seededCharacters ?? []);
  const [clears, setClears] = useState<BossClearsByCharacter>(
    peek<BossClearsByCharacter>(CLEARS_KEY) ?? {},
  );
  const [state, setState] = useState<LoadState>(
    seededBosses && seededCharacters ? "loaded" : "loading",
  );

  useEffect(() => {
    // One token for the whole burst. getToken() can round-trip to Clerk and that cost is paid
    // before each request goes out (see lib/api.ts), so three separate calls would pay it three
    // times. Mint once and share, as the inventory page does.
    getToken()
      .then((token) => {
        const withToken = () => Promise.resolve(token);
        return Promise.all([
          apiFetch<Boss[]>(BOSSES_KEY, { method: "GET" }, withToken),
          apiFetch<Character[]>(CHARACTERS_KEY, { method: "GET" }, withToken),
          apiFetch<BossClearsByCharacter>(CLEARS_KEY, { method: "GET" }, withToken),
        ]);
      })
      .then(([bossResult, characterResult, clearResult]) => {
        setBosses(bossResult);
        setCharacters(characterResult);
        setClears(clearResult);
        put(BOSSES_KEY, bossResult);
        put(CHARACTERS_KEY, characterResult);
        put(CLEARS_KEY, clearResult);
        setState("loaded");
      })
      // Only show the error state if we have nothing at all: a failed refresh behind data we
      // already have should not blank the page.
      .catch(() => setState((s) => (s === "loaded" ? "loaded" : "error")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="page">
      <h1 className="page-title">Boss clears</h1>

      {state === "error" && <p>Couldn&apos;t load your boss clears.</p>}

      {/* The loading state IS the real matrix with shimmer in its cells, so the two cannot drift
          apart. A separate skeleton that restated the table's metrics by hand is exactly what put
          the inventory window 30px out of place (#77). */}
      {state === "loading" && (
        <BossMatrix loading bosses={bosses} characters={characters} clearsByCharacter={{}} />
      )}

      {state === "loaded" &&
        (characters.length === 0 ? (
          <p className="finder-empty">
            Add a character on the Inventory page to start tracking clears.
          </p>
        ) : (
          <>
            <BossMatrix bosses={bosses} characters={characters} clearsByCharacter={clears} />
            <p className="hint">
              Clears come from Maple Planner screenshots. Upload one per character to fill this in;
              the list needs a capture per scroll position to be complete.
            </p>
          </>
        ))}
    </main>
  );
}
