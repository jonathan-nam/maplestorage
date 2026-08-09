"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import { AddCharacter } from "@/components/add-character";
import { CharacterRow } from "@/components/character-row";
import { ApiError, apiFetch } from "@/lib/api";
import { invalidate, peek, put } from "@/lib/cache";
import { SETTINGS_KEY, setAccountSettings, useAccountSettings } from "@/lib/use-account-settings";
import { otherWorld, worldLabel } from "@/lib/world";
import type { Character } from "@/types/character";
import type { Settings } from "@/types/settings";

const CHARACTERS_KEY = "/api/characters";

// Your characters, and everything you can do to one.
//
// Adding, ordering, refreshing and deleting. Which world a character is in is NOT among them: it
// comes from the ranking lookup, and refreshing is how a wrong one is corrected. The inventory
// carousel used to carry all this, which meant the strip you pick a character from was also the
// strip you managed them in. This is that page, and the carousel is now only a picker.

export default function CharactersPage() {
  const { getToken } = useAuth();
  const settings = useAccountSettings();

  const seeded = peek<Character[]>(CHARACTERS_KEY);
  const [characters, setCharacters] = useState<Character[]>(seeded ?? []);
  const [loaded, setLoaded] = useState(Boolean(seeded));
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A character the lookup put in the other world, on being added or refreshed. Not an error: it
  // is the app learning where a character actually is, and the one thing that would otherwise
  // happen with nothing on screen to show for it.
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
   * Optimistic because the alternative flickered, and nothing on the page is disabled while it is
   * in flight: .tile-move and .party-* both dim when disabled, so a page-wide busy flag made every
   * other row flash on a click that changed one of them.
   *
   * The caches are dropped rather than reasoned about. Only reordering goes through here now, and
   * that alone would not need it, but the cost is one request against a class of bug that is
   * silent: a screen drawn from a list this page has already replaced.
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

  // Written straight to state rather than through write(): these already hold the new roster, and
  // re-deriving it from a list this component is about to replace would fight itself.
  //
  // A character's world comes from the LOOKUP, so both adding and refreshing one can put it in a
  // world this list is not showing. Both take it off the list and say where it went, because a row
  // that disappears on the next load is worse than a line naming the world it is in.
  const placed = (character: Character) => {
    if (character.worldType === settings?.worldType) return true;
    setElsewhere(
      `${character.name} is in ${character.worldName ?? worldLabel(character.worldType)}.`,
    );
    return false;
  };
  const added = (character: Character) => {
    if (placed(character)) setCharacters((prev) => [...prev, character]);
    invalidate("/api/");
  };
  // A refresh is the only thing that can now move a character between worlds, so it is the only
  // place a row can leave this list without being deleted.
  const updated = (character: Character) => {
    if (placed(character)) {
      setCharacters((prev) => prev.map((c) => (c.id === character.id ? character : c)));
      return;
    }
    setCharacters((prev) => prev.filter((c) => c.id !== character.id));
    invalidate("/api/");
  };
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
