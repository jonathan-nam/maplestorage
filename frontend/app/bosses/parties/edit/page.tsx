"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useEffect, useState } from "react";
import { CharacterPicker } from "@/components/character-picker";
import { PartyConfigEditor } from "@/components/party-config-editor";
import { ApiError, apiFetch } from "@/lib/api";
import { peek, put } from "@/lib/cache";
import { preloadBossArt } from "@/lib/preload-boss-art";
import type { Boss } from "@/types/boss";
import type { Character } from "@/types/character";
import type { Party, Person, SavePartyBody } from "@/types/party";

type LoadState = "loading" | "loaded" | "error";

const PARTIES_KEY = "/api/parties";
const BOSSES_KEY = "/api/bosses";
const CHARACTERS_KEY = "/api/characters";
const PEOPLE_KEY = "/api/people";

// Editing, one character at a time. The Parties page answers "what are my parties"; this answers
// "change them", and it does it the way the question is asked: pick a character, then say who they
// run each boss with.
export default function EditPartiesPage() {
  // Before anything is fetched: see lib/preload-boss-art.ts.
  preloadBossArt();

  const { getToken } = useAuth();

  const [parties, setParties] = useState<Party[]>(peek<Party[]>(PARTIES_KEY) ?? []);
  const [bosses, setBosses] = useState<Boss[]>(peek<Boss[]>(BOSSES_KEY) ?? []);
  const [characters, setCharacters] = useState<Character[]>(
    peek<Character[]>(CHARACTERS_KEY) ?? [],
  );
  const [people, setPeople] = useState<Person[]>(peek<Person[]>(PEOPLE_KEY) ?? []);
  const [state, setState] = useState<LoadState>("loading");
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadParties(token?: string | null) {
    const result = await apiFetch<Party[]>(
      PARTIES_KEY,
      { method: "GET" },
      token !== undefined ? () => Promise.resolve(token) : getToken,
    );
    setParties(result);
    put(PARTIES_KEY, result);
  }

  useEffect(() => {
    getToken()
      .then((token) => {
        const withToken = () => Promise.resolve(token);
        return Promise.all([
          loadParties(token),
          apiFetch<Boss[]>(BOSSES_KEY, { method: "GET" }, withToken),
          apiFetch<Character[]>(CHARACTERS_KEY, { method: "GET" }, withToken),
          apiFetch<Person[]>(PEOPLE_KEY, { method: "GET" }, withToken),
        ]);
      })
      .then(([, bossResult, characterResult, peopleResult]) => {
        setBosses(bossResult);
        setCharacters(characterResult);
        setPeople(peopleResult);
        put(BOSSES_KEY, bossResult);
        put(CHARACTERS_KEY, characterResult);
        put(PEOPLE_KEY, peopleResult);
        // Open on the first character rather than on a prompt to choose one.
        setSelected((current) => current ?? characterResult[0]?.id ?? null);
        setState("loaded");
      })
      .catch(() => setState((s) => (s === "loaded" ? "loaded" : "error")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(body: SavePartyBody, partyId?: string) {
    setBusy(true);
    setError(null);
    try {
      await apiFetch<Party>(
        partyId ? `${PARTIES_KEY}/${partyId}` : PARTIES_KEY,
        { method: partyId ? "PUT" : "POST", body: JSON.stringify(body) },
        getToken,
      );
      // Refetched rather than spliced in: the server decides seat ids and which seat is yours.
      await loadParties();
    } catch (e) {
      // The backend refuses with the reason in the body (see validateNewParty). Showing it beats
      // "something went wrong" for the one thing the user can actually fix.
      setError(e instanceof ApiError ? e.body : "Couldn't save that party.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(party: Party) {
    setBusy(true);
    setError(null);
    try {
      await apiFetch<void>(`${PARTIES_KEY}/${party.id}`, { method: "DELETE" }, getToken);
      await loadParties();
    } catch (e) {
      setError(e instanceof ApiError ? e.body : "Couldn't remove that party.");
    } finally {
      setBusy(false);
    }
  }

  const character = characters.find((c) => c.id === selected) ?? null;
  // Every character named anywhere: your roster, the people list, and whoever is already in a
  // party. Typing a name the app already knows should not mean typing it differently.
  const knownCharacters = Array.from(
    new Set([
      ...characters.map((c) => c.name),
      ...people.flatMap((p) => p.characters),
      ...parties.flatMap((p) => p.members.map((m) => m.name)),
    ]),
  ).sort();

  return (
    <main className="page">
      <p className="loot-back">
        <Link href="/bosses/parties">&larr; Parties</Link>
      </p>
      <h1 className="page-title">Edit parties</h1>
      <p className="split-intro">
        Pick a character, then say who they run each boss with. A boss they solo needs no party, so
        leave it out. Who plays which character lives on the{" "}
        <Link href="/bosses/people">People</Link> page.
      </p>

      {state === "error" && <p>Couldn&apos;t load your parties.</p>}
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

            {character && (
              <PartyConfigEditor
                characterId={character.id}
                characterName={character.name}
                parties={parties.filter((p) => p.characterId === character.id)}
                bosses={bosses}
                knownCharacters={knownCharacters}
                busy={busy}
                error={error}
                onSave={save}
                onDelete={remove}
              />
            )}
          </>
        ))}
    </main>
  );
}
