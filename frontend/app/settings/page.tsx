"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError, apiFetch } from "@/lib/api";
import { invalidate, peek, put } from "@/lib/cache";
import { SETTINGS_KEY, setAccountSettings, useAccountSettings } from "@/lib/use-account-settings";
import { worldLabel, WORLD_TYPES, type WorldType } from "@/lib/world";
import type { Character } from "@/types/character";
import type { Settings } from "@/types/settings";

const CHARACTERS_KEY = "/api/characters";

// Which world each character is in.
//
// Per character, not per account, because one account can play both: the Interactive main and the
// Reboot mule are different answers to "can this party's drops be sold". The account keeps one
// world of its own, but only as what a newly added character starts in.

export default function SettingsPage() {
  const { getToken } = useAuth();

  const settings = useAccountSettings();
  const [characters, setCharacters] = useState<Character[]>(
    peek<Character[]>(CHARACTERS_KEY) ?? [],
  );
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getToken()
      .then((token) => {
        const withToken = () => Promise.resolve(token);
        return Promise.all([
          apiFetch<Character[]>(CHARACTERS_KEY, { method: "GET" }, withToken),
          apiFetch<Settings>(SETTINGS_KEY, { method: "GET" }, withToken),
        ]);
      })
      .then(([characterResult, settingsResult]) => {
        setCharacters(characterResult);
        put(CHARACTERS_KEY, characterResult);
        setAccountSettings(settingsResult);
        setLoaded(true);
      })
      .catch(() => setFailed(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Both writes end here.
   *
   * A world decides whether a party can sell, and /api/parties has already been cached with the
   * old answer, so the caller that reads it next would draw a price box on a Heroic pool. Dropping
   * the entry is the whole of the fix: the next visit refetches.
   */
  async function write(run: () => Promise<Character[]>) {
    setBusy(true);
    setError(null);
    try {
      const updated = await run();
      setCharacters(updated);
      put(CHARACTERS_KEY, updated);
      invalidate("/api/parties");
      // Refetched rather than worked out here. `trades` is the server's answer, and a second one
      // computed on this page is a second answer to what the whole menu keys off.
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

  const setOne = (id: string, next: WorldType) =>
    write(async () => {
      const saved = await apiFetch<Character>(
        `${CHARACTERS_KEY}/${id}`,
        { method: "PUT", body: JSON.stringify({ worldType: next }) },
        getToken,
      );
      return characters.map((c) => (c.id === id ? saved : c));
    });

  // Null when they differ, which draws neither option as chosen rather than picking one of them to
  // claim. Same shape as a select-all box with a mixed state.
  const worlds = new Set(characters.map((c) => c.worldType));
  const common: WorldType | null = worlds.size === 1 ? ([...worlds][0] ?? null) : null;

  return (
    <main className="page">
      <h1 className="page-title">Settings</h1>

      {failed && <p>Couldn&apos;t load your settings.</p>}
      {!loaded && !failed && <p className="party-hint">Loading...</p>}

      {loaded && characters.length === 0 && (
        <p className="finder-empty">
          Add a character on the <Link href="/inventory">Inventory</Link> page first.
        </p>
      )}

      {loaded && characters.length > 0 && (
        <>
          <h2 className="settings-heading">World</h2>
          <div className="setting-list">
            {/* Redundant with the one row below it when there is only one character. */}
            {characters.length > 1 && (
              <WorldRow
                id="all"
                name="All characters"
                world={common}
                busy={busy}
                onChoose={setAll}
              />
            )}
            {characters.map((character) => (
              <WorldRow
                key={character.id}
                id={character.id}
                name={character.name}
                world={character.worldType}
                busy={busy}
                onChoose={(next) => setOne(character.id, next)}
              />
            ))}
          </div>
        </>
      )}

      {error && <p className="routine-error">{error}</p>}

      {/* Not said unless it is true: with every character in one world there is no default to
          notice, because it is the world they are all already in. */}
      {loaded && settings && common === null && (
        <p className="party-hint">New characters start in {worldLabel(settings.worldType)}.</p>
      )}
    </main>
  );
}

function WorldRow({
  id,
  name,
  world,
  busy,
  onChoose,
}: {
  // Labels the group. The character's own id, because two characters of yours can be told apart
  // by it and a name is not guaranteed to make a unique one.
  id: string;
  name: string;
  /** Null draws neither option chosen: these characters do not agree. */
  world: WorldType | null;
  busy: boolean;
  onChoose: (next: WorldType) => void;
}) {
  return (
    <div className="setting-row">
      <span className="setting-label" id={`world-${id}`}>
        {name}
      </span>
      <div className="basis-row" role="group" aria-labelledby={`world-${id}`}>
        {WORLD_TYPES.map((option) => (
          <button
            key={option}
            type="button"
            className={world === option ? "basis-tab active" : "basis-tab"}
            aria-pressed={world === option}
            disabled={busy}
            onClick={() => onChoose(option)}
          >
            {worldLabel(option)}
          </button>
        ))}
      </div>
    </div>
  );
}
