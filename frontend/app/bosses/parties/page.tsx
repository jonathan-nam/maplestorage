"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useEffect, useState } from "react";
import { PartyCard } from "@/components/party-card";
import { apiAssetUrl, apiFetch } from "@/lib/api";
import { peek, put } from "@/lib/cache";
import { byBoss, byCharacter } from "@/lib/parties";
import { preloadBossArt } from "@/lib/preload-boss-art";
import type { Boss } from "@/types/boss";
import type { Character } from "@/types/character";
import type { Party } from "@/types/party";

type LoadState = "loading" | "loaded" | "error";

// The same configs, read two ways. By character: what does this character owe the week. By boss:
// who am I doing Kalos with tonight. Neither is a filter, so nothing is ever hidden by the choice.
type Grouping = "character" | "boss";

const PARTIES_KEY = "/api/parties";
const BOSSES_KEY = "/api/bosses";
const CHARACTERS_KEY = "/api/characters";

export default function PartiesPage() {
  // Before anything is fetched: see lib/preload-boss-art.ts.
  preloadBossArt();

  const { getToken } = useAuth();

  const seededParties = peek<Party[]>(PARTIES_KEY);
  const seededBosses = peek<Boss[]>(BOSSES_KEY);
  const seededCharacters = peek<Character[]>(CHARACTERS_KEY);

  const [parties, setParties] = useState<Party[]>(seededParties ?? []);
  const [bosses, setBosses] = useState<Boss[]>(seededBosses ?? []);
  const [characters, setCharacters] = useState<Character[]>(seededCharacters ?? []);
  const [state, setState] = useState<LoadState>(
    seededParties && seededBosses && seededCharacters ? "loaded" : "loading",
  );
  const [grouping, setGrouping] = useState<Grouping>("character");

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

  const characterById = new Map(characters.map((c) => [c.id, c]));
  const bossByKey = new Map(bosses.map((b) => [b.bossKey, b]));
  const characterGroups = byCharacter(
    parties,
    characters.map((c) => c.id),
  );
  const bossGroups = byBoss(parties, bosses);

  return (
    <main className="page">
      <h1 className="page-title">Parties</h1>
      <p className="split-intro">
        What each character runs each boss with. A boss they solo has no party, so it is not here. A
        party is a roster, not a clear: what died stays on Boss Clears, read from your planner.
      </p>

      {state === "error" && <p>Couldn&apos;t load your parties.</p>}
      {state === "loading" && <p className="party-hint">Loading...</p>}

      {state === "loaded" && (
        <>
          <div className="party-toolbar">
            <div className="basis-row" role="group" aria-label="Group parties by">
              <button
                type="button"
                className={grouping === "character" ? "basis-tab active" : "basis-tab"}
                onClick={() => setGrouping("character")}
              >
                By character
              </button>
              <button
                type="button"
                className={grouping === "boss" ? "basis-tab active" : "basis-tab"}
                onClick={() => setGrouping("boss")}
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
              No parties yet. <Link href="/bosses/parties/edit">Set them up</Link>: pick a
              character, then say who they run each boss with.
            </p>
          )}

          {grouping === "character" &&
            characterGroups.map((group) => {
              const character = characterById.get(group.key);
              return (
                <section className="party-group" key={group.key}>
                  <header className="party-group-head">
                    {character?.spriteImgUrl && (
                      <img className="party-group-sprite" src={character.spriteImgUrl} alt="" />
                    )}
                    <h2 className="party-group-name">{character?.name ?? "Unknown character"}</h2>
                  </header>
                  <div className="party-list">
                    {group.parties.map((party) => (
                      <article className="boss-run" key={party.id}>
                        <header className="boss-run-head">
                          {bossByKey.get(party.bossKey)?.iconUrl && (
                            <img
                              className="boss-portrait"
                              src={apiAssetUrl(bossByKey.get(party.bossKey)!.iconUrl!)}
                              alt=""
                            />
                          )}
                          <h3 className="boss-run-name">
                            {bossByKey.get(party.bossKey)?.name ?? party.bossKey}
                          </h3>
                        </header>
                        <PartyCard party={party} />
                      </article>
                    ))}
                  </div>
                </section>
              );
            })}

          {grouping === "boss" &&
            bossGroups.map((group) => (
              <section className="party-group" key={group.key.bossKey}>
                <header className="party-group-head">
                  {group.key.iconUrl && (
                    <img className="boss-portrait" src={apiAssetUrl(group.key.iconUrl)} alt="" />
                  )}
                  <h2 className="party-group-name">{group.key.name}</h2>
                </header>
                <div className="party-list">
                  {group.parties.map((party) => (
                    <article className="boss-run" key={party.id}>
                      <header className="boss-run-head">
                        {characterById.get(party.characterId)?.spriteImgUrl && (
                          <img
                            className="seat-sprite"
                            src={characterById.get(party.characterId)!.spriteImgUrl!}
                            alt=""
                          />
                        )}
                        <h3 className="boss-run-name">
                          {characterById.get(party.characterId)?.name ?? "Unknown character"}
                        </h3>
                      </header>
                      <PartyCard party={party} />
                    </article>
                  ))}
                </div>
              </section>
            ))}
        </>
      )}
    </main>
  );
}
