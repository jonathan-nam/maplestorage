"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import { PartyCard } from "@/components/party-card";
import { PartyGridEditor } from "@/components/party-grid-editor";
import { ApiError, apiFetch } from "@/lib/api";
import { preloadBossArt } from "@/lib/preload-boss-art";
import { peek, put } from "@/lib/cache";
import { partiesByCharacter } from "@/lib/parties";
import type { Boss } from "@/types/boss";
import type { Character } from "@/types/character";
import type { PartyGrid, SaveGridBody } from "@/types/party";

type LoadState = "loading" | "loaded" | "error";

const GRID_KEY = "/api/parties/grid";
const BOSSES_KEY = "/api/bosses";
const CHARACTERS_KEY = "/api/characters";

export default function PartiesPage() {
  // Before anything is fetched: see lib/preload-boss-art.ts.
  preloadBossArt();

  const { getToken } = useAuth();

  // Seeded from cache so a repeat visit paints immediately, as the other pages do. See lib/cache.ts.
  const seededGrid = peek<PartyGrid>(GRID_KEY);
  const seededBosses = peek<Boss[]>(BOSSES_KEY);
  const seededCharacters = peek<Character[]>(CHARACTERS_KEY);

  const [grid, setGrid] = useState<PartyGrid>(seededGrid ?? { people: [], parties: [] });
  const [bosses, setBosses] = useState<Boss[]>(seededBosses ?? []);
  const [characters, setCharacters] = useState<Character[]>(seededCharacters ?? []);
  const [state, setState] = useState<LoadState>(
    seededGrid && seededBosses && seededCharacters ? "loaded" : "loading",
  );

  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function loadGrid(token?: string | null) {
    const result = await apiFetch<PartyGrid>(
      GRID_KEY,
      { method: "GET" },
      token !== undefined ? () => Promise.resolve(token) : getToken,
    );
    setGrid(result);
    put(GRID_KEY, result);
  }

  useEffect(() => {
    // One token for the whole burst, as the boss page does: getToken() can round-trip to Clerk,
    // and three calls would pay that three times.
    getToken()
      .then((token) => {
        const withToken = () => Promise.resolve(token);
        return Promise.all([
          loadGrid(token),
          apiFetch<Boss[]>(BOSSES_KEY, { method: "GET" }, withToken),
          apiFetch<Character[]>(CHARACTERS_KEY, { method: "GET" }, withToken),
        ]);
      })
      .then(([, bossResult, characterResult]) => {
        setBosses(bossResult);
        setCharacters(characterResult);
        put(BOSSES_KEY, bossResult);
        put(CHARACTERS_KEY, characterResult);
        setState("loaded");
      })
      // Only blank the page if there is nothing to show: a failed refresh behind data we already
      // have should leave that data up.
      .catch(() => setState((s) => (s === "loaded" ? "loaded" : "error")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(body: SaveGridBody) {
    setBusy(true);
    setSaveError(null);
    try {
      const saved = await apiFetch<PartyGrid>(
        GRID_KEY,
        { method: "PUT", body: JSON.stringify(body) },
        getToken,
      );
      // The server's answer, not the draft: it decides seat ids, person ids and boss order, and a
      // grid assembled here would be a second answer to what was just saved.
      setGrid(saved);
      put(GRID_KEY, saved);
    } catch (e) {
      // The backend refuses a bad grid with the reason in the body (see validateGrid). Showing it
      // beats "something went wrong" for the one thing the user can actually fix.
      setSaveError(e instanceof ApiError ? e.body : "Couldn't save the grid.");
    } finally {
      setBusy(false);
    }
  }

  const bossByKey = new Map(bosses.map((b) => [b.bossKey, b]));
  const characterById = new Map(characters.map((c) => [c.id, c]));
  const groups = partiesByCharacter(
    grid.parties,
    characters.map((c) => c.id),
  );

  return (
    <main className="page">
      <h1 className="page-title">Parties</h1>
      <p className="split-intro">
        Who each character actually runs with. A party is a roster, not a clear: what died stays on
        Boss Clears, read from your planner.
      </p>

      {state === "error" && <p>Couldn&apos;t load your parties.</p>}
      {state === "loading" && <p className="party-hint">Loading...</p>}

      {state === "loaded" && (
        <>
          {/* The grid IS the editor. Cards below are the read view, and the way into a pool. */}
          <PartyGridEditor
            // Remounted when the server's grid changes, so the draft starts from what was saved
            // rather than from a stale copy of it.
            key={grid.parties.map((p) => p.id).join() + grid.people.map((p) => p.id).join()}
            grid={grid}
            bosses={bosses}
            busy={busy}
            error={saveError}
            onSave={save}
          />

          {grid.parties.length === 0 && (
            <p className="finder-empty">
              Nothing yet. Add a person, add a party, and put the character they bring in the cell.
            </p>
          )}

          {groups.map((group) => {
            const character = group.characterId ? characterById.get(group.characterId) : null;
            return (
              <section className="party-group" key={group.characterId ?? "unseated"}>
                <header className="party-group-head">
                  {character?.spriteImgUrl && (
                    <img className="party-group-sprite" src={character.spriteImgUrl} alt="" />
                  )}
                  <h2 className="party-group-name">
                    {/* A party with none of your characters in it is still yours to track: it
                        just has no character to file it under. */}
                    {character?.name ?? "No character in these"}
                  </h2>
                </header>
                <div className="party-list">
                  {group.parties.map((party) => (
                    <PartyCard key={party.id} party={party} bossByKey={bossByKey} />
                  ))}
                </div>
              </section>
            );
          })}
        </>
      )}
    </main>
  );
}
