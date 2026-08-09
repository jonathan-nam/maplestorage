"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import { AddCharacter } from "@/components/add-character";
import { CharacterRow } from "@/components/character-row";
import { ApiError, apiFetch } from "@/lib/api";
import { invalidate, peek, put } from "@/lib/cache";
import { SETTINGS_KEY, setAccountSettings, useAccountSettings } from "@/lib/use-account-settings";
import { otherWorld, worldLabel, type WorldType } from "@/lib/world";
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
  const [error, setError] = useState<string | null>(null);
  // A character that was added into the other world. Not an error, and not permanent state: it is
  // the one thing that would otherwise happen with nothing on screen to show for it.
  const [elsewhere, setElsewhere] = useState<string | null>(null);

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
   * Shows the change, then persists it, and puts it back if the server refuses.
   *
   * Optimistic because the alternative flickered. This used to set one `busy` flag for the round
   * trip AND the settings refetch after it, and every control on the page took it: .tile-move and
   * .party-* all dim when disabled, so clicking one character's world flashed the arrows and
   * buttons of every other row while the toggle you clicked (.basis-tab, which has no disabled
   * style) sat still. Nothing is disabled here now.
   *
   * A world decides whether a party can sell and a deletion takes party seats with it, so the
   * cached /api/parties is wrong either way and the next page to read it would draw the old
   * answer. `trades` is refetched rather than worked out locally: it is what the section menu and
   * the Drop Log's totals key off, and a second answer computed here is a second answer.
   */
  async function persist(apply: (list: Character[]) => Character[], save: () => Promise<unknown>) {
    const before = characters;
    const shown = apply(before);
    setCharacters(shown);
    put(CHARACTERS_KEY, shown);
    setError(null);
    try {
      await save();
      invalidate("/api/parties");
      invalidate("/api/bosses");
      setAccountSettings(await apiFetch<Settings>(SETTINGS_KEY, { method: "GET" }, getToken));
    } catch (e) {
      // Back to what the server still holds. Leaving the optimistic value up would put a world on
      // screen that no party actually reads.
      setCharacters(before);
      put(CHARACTERS_KEY, before);
      setError(e instanceof ApiError ? e.body : "Couldn't save that.");
    }
  }

  // Moves the character OUT of the list it is in, which is the point of it: this is how a
  // character added in the wrong world gets to the right one. It leaves the page rather than
  // changing colour, so the optimistic step drops it.
  const setWorld = (id: string, next: WorldType) => {
    // Clicking the world a character is already in is not a change to save.
    if (characters.find((c) => c.id === id)?.worldType === next) return;
    return persist(
      (list) => list.filter((c) => c.id !== id),
      () =>
        apiFetch<Character>(
          `${CHARACTERS_KEY}/${id}`,
          { method: "PUT", body: JSON.stringify({ worldType: next }) },
          getToken,
        ),
    );
  };

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
    return persist(
      () => next,
      () =>
        apiFetch<Character[]>(
          `${CHARACTERS_KEY}/order`,
          { method: "PUT", body: JSON.stringify({ orderedIds: next.map((c) => c.id) }) },
          getToken,
        ),
    );
  };

  // Written straight to state rather than through write(): these two already hold the new roster,
  // and re-deriving it from a list this component is about to replace would fight itself.
  //
  // A new character lands in the world the LOOKUP found, which need not be the one on screen. Kept
  // off the list when it is not, because a row that disappears on the next load is worse than a
  // line saying where it went.
  const added = (character: Character) => {
    if (character.worldType === settings?.worldType) {
      setCharacters((prev) => [...prev, character]);
    } else {
      setElsewhere(
        `${character.name} is in ${character.worldName ?? worldLabel(character.worldType)}.`,
      );
    }
    invalidate("/api/");
  };
  const updated = (character: Character) =>
    setCharacters((prev) => prev.map((c) => (c.id === character.id ? character : c)));
  const deleted = (id: string) => {
    setCharacters((prev) => prev.filter((c) => c.id !== id));
    invalidate("/api/");
  };

  return (
    <main className="page">
      <div className="settings-section-head">
        <h1 className="page-title">Characters</h1>
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

          {elsewhere && <p className="party-hint">{elsewhere}</p>}

          {/* The list is one world's. This is the rest of the account, and it is said because an
              empty page in the wrong world looks exactly like an account with no characters. */}
          {settings && settings.otherWorldCharacters > 0 && (
            <p className="party-hint">
              {settings.otherWorldCharacters}{" "}
              {settings.otherWorldCharacters === 1 ? "character" : "characters"} in{" "}
              {worldLabel(otherWorld(settings.worldType))}.
            </p>
          )}
        </>
      )}
    </main>
  );
}
