"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useEffect, useState } from "react";
import { PartyCard } from "@/components/party-card";
import { apiAssetUrl, apiFetch } from "@/lib/api";
import { peek, put } from "@/lib/cache";
import { partiesByCharacter, runsByBoss } from "@/lib/parties";
import { preloadBossArt } from "@/lib/preload-boss-art";
import type { Boss } from "@/types/boss";
import type { Character } from "@/types/character";
import type { Party } from "@/types/party";

type LoadState = "loading" | "loaded" | "error";

// Grouped: one card per party, however many bosses it runs. By boss: that same party once per
// boss, because a duo that does three bosses is three things to do on a Thursday, not one.
type View = "grouped" | "by-boss";

const PARTIES_KEY = "/api/parties";
const BOSSES_KEY = "/api/bosses";
const CHARACTERS_KEY = "/api/characters";

export default function PartiesPage() {
  // Before anything is fetched: see lib/preload-boss-art.ts.
  preloadBossArt();

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
  const [view, setView] = useState<View>("grouped");

  useEffect(() => {
    // One token for the whole burst, as the boss page does: getToken() can round-trip to Clerk,
    // and three calls would pay that three times.
    getToken()
      .then((token) => {
        const withToken = () => Promise.resolve(token);
        return Promise.all([
          apiFetch<Party[]>(PARTIES_KEY, { method: "GET" }, withToken),
          apiFetch<Boss[]>(BOSSES_KEY, { method: "GET" }, withToken),
          apiFetch<Character[]>(CHARACTERS_KEY, { method: "GET" }, withToken),
        ]);
      })
      .then(([partyResult, bossResult, characterResult]) => {
        setParties(partyResult);
        setBosses(bossResult);
        setCharacters(characterResult);
        put(PARTIES_KEY, partyResult);
        put(BOSSES_KEY, bossResult);
        put(CHARACTERS_KEY, characterResult);
        setState("loaded");
      })
      // Only blank the page if there is nothing to show: a failed refresh behind data we already
      // have should leave that data up.
      .catch(() => setState((s) => (s === "loaded" ? "loaded" : "error")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const bossByKey = new Map(bosses.map((b) => [b.bossKey, b]));
  const characterById = new Map(characters.map((c) => [c.id, c]));
  const groups = partiesByCharacter(
    parties,
    characters.map((c) => c.id),
  );
  const runs = runsByBoss(parties, bosses);

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
          <div className="party-toolbar">
            <div className="basis-row" role="group" aria-label="How to list parties">
              <button
                type="button"
                className={view === "grouped" ? "basis-tab active" : "basis-tab"}
                onClick={() => setView("grouped")}
              >
                By party
              </button>
              <button
                type="button"
                className={view === "by-boss" ? "basis-tab active" : "basis-tab"}
                onClick={() => setView("by-boss")}
              >
                By boss
              </button>
            </div>
            <Link className="party-cancel" href="/bosses/parties/edit">
              Edit parties
            </Link>
          </div>

          {parties.length === 0 && (
            <p className="finder-empty">
              No parties yet. <Link href="/bosses/parties/edit">Set them up</Link> as a grid: a
              column per person, a row per party.
            </p>
          )}

          {view === "by-boss" && runs.length === 0 && parties.length > 0 && (
            // Every party exists but none says which boss it runs, so there is nothing to list
            // under a boss. Saying so beats an empty page that looks like a failed load.
            <p className="finder-empty">
              None of your parties has a boss assigned yet. Add one in{" "}
              <Link href="/bosses/parties/edit">the grid</Link>.
            </p>
          )}

          {view === "by-boss" && runs.length > 0 && (
            <div className="party-list">
              {runs.map(({ boss, party }) => (
                <article className="boss-run" key={`${boss.key}-${party.id}`}>
                  <header className="boss-run-head">
                    {boss.iconUrl && (
                      <img className="boss-portrait" src={apiAssetUrl(boss.iconUrl)} alt="" />
                    )}
                    <h3 className="boss-run-name">{boss.name}</h3>
                  </header>
                  {/* The party's own bosses are not repeated here: this card IS one of them, and
                      listing the other two under it reads as though they were also this row. */}
                  <PartyCard party={party} bossByKey={bossByKey} hideBosses />
                </article>
              ))}
            </div>
          )}

          {view === "grouped" &&
            groups.map((group) => {
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
