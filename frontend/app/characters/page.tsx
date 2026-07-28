"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import { AddCharacter } from "@/components/add-character";
import { CharacterRow } from "@/components/character-row";
import { ApiError, apiFetch } from "@/lib/api";
import { invalidate, peek, put } from "@/lib/cache";
import { SETTINGS_KEY, setAccountSettings, useAccountSettings } from "@/lib/use-account-settings";
import { worldLabel, WORLD_TYPES, type WorldType } from "@/lib/world";
import type { Character } from "@/types/character";
import type { Settings } from "@/types/settings";

const CHARACTERS_KEY = "/api/characters";

// Your characters, and everything that is true of one.
//
// Adding, ordering, deleting and which world each plays in all live here. The inventory carousel
// used to carry them, which meant the strip you pick a character from was also the strip you
// managed them in, and a world control had nowhere to go but a settings page it had nothing to do
// with. This is that page, and the carousel is now only a picker.

export default function CharactersPage() {
  const { getToken } = useAuth();
  const settings = useAccountSettings();

  const seeded = peek<Character[]>(CHARACTERS_KEY);
  const [characters, setCharacters] = useState<Character[]>(seeded ?? []);
  const [loaded, setLoaded] = useState(Boolean(seeded));
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<Character[]>(CHARACTERS_KEY, { method: "GET" }, getToken)
      .then((result) => {
        setCharacters(result);
        put(CHARACTERS_KEY, result);
        setLoaded(true);
      })
      .catch(() => setFailed(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Every write here ends in the same place.
   *
   * A world decides whether a party can sell and a deletion takes party seats with it, so the
   * cached /api/parties is wrong either way and the next page to read it would draw from the old
   * answer. `trades` is refetched rather than worked out locally: it is what the section menu and
   * the Drop Log's totals key off, and a second answer computed here is a second answer.
   */
  async function write(run: () => Promise<Character[]>) {
    setBusy(true);
    setError(null);
    try {
      const updated = await run();
      setCharacters(updated);
      put(CHARACTERS_KEY, updated);
      invalidate("/api/parties");
      invalidate("/api/bosses");
      setAccountSettings(await apiFetch<Settings>(SETTINGS_KEY, { method: "GET" }, getToken));
    } catch (e) {
      setError(e instanceof ApiError ? e.body : "Couldn't save that.");
    } finally {
      setBusy(false);
    }
  }

  const setAll = (next: WorldType) =>
    write(async () => {
      await apiFetch<Settings>(
        SETTINGS_KEY,
        { method: "PUT", body: JSON.stringify({ worldType: next }) },
        getToken,
      );
      return characters.map((c) => ({ ...c, worldType: next }));
    });

  const setWorld = (id: string, next: WorldType) =>
    write(async () => {
      const saved = await apiFetch<Character>(
        `${CHARACTERS_KEY}/${id}`,
        { method: "PUT", body: JSON.stringify({ worldType: next }) },
        getToken,
      );
      return characters.map((c) => (c.id === id ? saved : c));
    });

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= characters.length) return;
    const next = characters.slice();
    const moved = next[index];
    const displaced = next[target];
    // Bounds already guarantee both exist; the guard is what tells the type checker so.
    if (!moved || !displaced) return;
    next[index] = displaced;
    next[target] = moved;
    return write(async () => {
      await apiFetch<Character[]>(
        `${CHARACTERS_KEY}/order`,
        { method: "PUT", body: JSON.stringify({ orderedIds: next.map((c) => c.id) }) },
        getToken,
      );
      return next;
    });
  };

  // Written straight to state rather than through write(): these two already hold the new roster,
  // and re-deriving it from a list this component is about to replace would fight itself.
  const added = (character: Character) => {
    setCharacters((prev) => [...prev, character]);
    invalidate("/api/");
  };
  const updated = (character: Character) =>
    setCharacters((prev) => prev.map((c) => (c.id === character.id ? character : c)));
  const deleted = (id: string) => {
    setCharacters((prev) => prev.filter((c) => c.id !== id));
    invalidate("/api/");
  };

  // Null when they do not agree, which is what stops "Set all X" being offered when they already
  // all are, and what decides whether the default below is worth saying.
  const worlds = new Set(characters.map((c) => c.worldType));
  const common: WorldType | null = worlds.size === 1 ? ([...worlds][0] ?? null) : null;

  return (
    <main className="page">
      <div className="settings-section-head">
        <h1 className="page-title">Characters</h1>
        {/* Two actions, not a third toggle. An "All characters" row drawn with the same control
            as the characters under it read as one of them, and every click went there. */}
        {characters.length > 1 && (
          <span className="settings-bulk">
            {WORLD_TYPES.map((option) => (
              <button
                key={option}
                type="button"
                className="party-cancel"
                disabled={busy || common === option}
                onClick={() => setAll(option)}
              >
                Set all {worldLabel(option)}
              </button>
            ))}
          </span>
        )}
      </div>

      {failed && !loaded && <p>Couldn&apos;t load your characters.</p>}
      {!loaded && !failed && <p className="party-hint">Loading...</p>}

      {loaded && (
        <>
          <ul className="character-list">
            {characters.map((character, index) => (
              <CharacterRow
                key={character.id}
                character={character}
                busy={busy}
                onUpdated={updated}
                onDeleted={deleted}
                onSetWorld={(next) => setWorld(character.id, next)}
                onMove={(direction) => move(index, direction)}
                canMoveUp={index > 0}
                canMoveDown={index < characters.length - 1}
              />
            ))}
          </ul>

          <AddCharacter onAdded={added} />

          {error && <p className="routine-error">{error}</p>}

          {/* Not said unless it is true: with every character in one world there is no default to
              notice, because it is the world they are all already in. */}
          {settings && common === null && (
            <p className="party-hint">New characters start in {worldLabel(settings.worldType)}.</p>
          )}
        </>
      )}
    </main>
  );
}
