"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import { PartyCard } from "@/components/party-card";
import { PartyEditor } from "@/components/party-editor";
import { ApiError, apiFetch } from "@/lib/api";
import { peek, put } from "@/lib/cache";
import { partiesByCharacter, partyLabel } from "@/lib/parties";
import type { Boss } from "@/types/boss";
import type { Character } from "@/types/character";
import type { Party, SavePartyBody } from "@/types/party";

type LoadState = "loading" | "loaded" | "error";

const PARTIES_KEY = "/api/parties";
const BOSSES_KEY = "/api/bosses";
const CHARACTERS_KEY = "/api/characters";

export default function PartiesPage() {
  const { getToken } = useAuth();

  // Seeded from cache so a repeat visit paints immediately, as the other pages do. See lib/cache.ts.
  const seededParties = peek<Party[]>(PARTIES_KEY);
  const seededBosses = peek<Boss[]>(BOSSES_KEY);
  const seededCharacters = peek<Character[]>(CHARACTERS_KEY);

  const [parties, setParties] = useState<Party[]>(seededParties ?? []);
  const [bosses, setBosses] = useState<Boss[]>(seededBosses ?? []);
  const [characters, setCharacters] = useState<Character[]>(seededCharacters ?? []);
  const [state, setState] = useState<LoadState>(
    seededParties && seededBosses && seededCharacters ? "loaded" : "loading",
  );

  // Null when nothing is being edited, "new" for a party that does not exist yet.
  const [editing, setEditing] = useState<Party | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Party | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

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
    // One token for the whole burst, as the boss page does: getToken() can round-trip to Clerk,
    // and three calls would pay that three times.
    getToken()
      .then((token) => {
        const withToken = () => Promise.resolve(token);
        return Promise.all([
          loadParties(token),
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

  async function save(body: SavePartyBody) {
    const target = editing === "new" ? null : editing;
    setBusy(true);
    setSaveError(null);
    try {
      await apiFetch<Party>(
        target ? `${PARTIES_KEY}/${target.id}` : PARTIES_KEY,
        { method: target ? "PUT" : "POST", body: JSON.stringify(body) },
        getToken,
      );
      // Refetch rather than splice the response in: the server decides seat ids and boss order,
      // and a list assembled here would be a second answer to what was just saved.
      await loadParties();
      setEditing(null);
    } catch (e) {
      // The backend refuses a bad party with the reason in the body (see validateParty). Showing
      // it beats "something went wrong" for the one thing the user can actually fix.
      setSaveError(e instanceof ApiError ? e.body : "Couldn't save that party.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(party: Party) {
    setBusy(true);
    try {
      await apiFetch<void>(`${PARTIES_KEY}/${party.id}`, { method: "DELETE" }, getToken);
      await loadParties();
      setConfirmDelete(null);
    } catch {
      setConfirmDelete(null);
    } finally {
      setBusy(false);
    }
  }

  const bossByKey = new Map(bosses.map((b) => [b.bossKey, b]));
  const characterById = new Map(characters.map((c) => [c.id, c]));
  const groups = partiesByCharacter(
    parties,
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
          {editing === null && (
            <button type="button" className="party-save" onClick={() => setEditing("new")}>
              + New party
            </button>
          )}

          {editing !== null && (
            <PartyEditor
              party={editing === "new" ? null : editing}
              bosses={bosses}
              characters={characters}
              busy={busy}
              error={saveError}
              onSave={save}
              onCancel={() => {
                setEditing(null);
                setSaveError(null);
              }}
            />
          )}

          {confirmDelete && (
            <div className="party-confirm">
              <span>Delete “{partyLabel(confirmDelete)}”?</span>
              <button
                type="button"
                className="party-delete"
                disabled={busy}
                onClick={() => remove(confirmDelete)}
              >
                Delete
              </button>
              <button
                type="button"
                className="party-cancel"
                disabled={busy}
                onClick={() => setConfirmDelete(null)}
              >
                Keep
              </button>
            </div>
          )}

          {parties.length === 0 && editing === null && (
            <p className="finder-empty">
              No parties yet. Add the group you run Baldrix or Kalos with, and it will show up under
              that character.
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
                    <PartyCard
                      key={party.id}
                      party={party}
                      bossByKey={bossByKey}
                      busy={busy}
                      onEdit={() => {
                        setSaveError(null);
                        setEditing(party);
                      }}
                      onDelete={() => setConfirmDelete(party)}
                    />
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
