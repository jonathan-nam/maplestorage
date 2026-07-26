"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useEffect, useState } from "react";
import { PartyCard } from "@/components/party-card";
import { apiAssetUrl, apiFetch } from "@/lib/api";
import { peek, put } from "@/lib/cache";
import { expandParties } from "@/lib/parties";
import { preloadBossArt } from "@/lib/preload-boss-art";
import type { Boss } from "@/types/boss";
import type { Character } from "@/types/character";
import type { Party } from "@/types/party";

type LoadState = "loading" | "loaded" | "error";

// Two independent splits, not two modes. A duo that runs three bosses is one row, three rows or
// three rows per character of yours in it, depending on which of these is on.

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
  const [byBoss, setByBoss] = useState(false);
  const [byCharacter, setByCharacter] = useState(false);

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
  const rows = expandParties(
    parties,
    bosses,
    characters.map((c) => c.id),
    { byBoss, byCharacter },
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
          <div className="party-toolbar">
            <div className="party-splits" role="group" aria-label="Split the list by">
              <label className={byBoss ? "party-chip is-on" : "party-chip"}>
                <input
                  type="checkbox"
                  checked={byBoss}
                  onChange={(e) => setByBoss(e.target.checked)}
                />
                By boss
              </label>
              <label className={byCharacter ? "party-chip is-on" : "party-chip"}>
                <input
                  type="checkbox"
                  checked={byCharacter}
                  onChange={(e) => setByCharacter(e.target.checked)}
                />
                By character
              </label>
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

          <div className="party-list">
            {rows.map(({ party, boss, characterId }) => {
              const character = characterId ? characterById.get(characterId) : null;
              const heading = boss || character;
              return (
                <article
                  className="boss-run"
                  key={`${party.id}-${boss?.key ?? ""}-${characterId ?? ""}`}
                >
                  {heading && (
                    <header className="boss-run-head">
                      {boss?.iconUrl && (
                        <img className="boss-portrait" src={apiAssetUrl(boss.iconUrl)} alt="" />
                      )}
                      {boss && <h3 className="boss-run-name">{boss.name}</h3>}
                      {character && (
                        <span className="boss-run-character">
                          {character.spriteImgUrl && (
                            <img className="seat-sprite" src={character.spriteImgUrl} alt="" />
                          )}
                          {character.name}
                        </span>
                      )}
                    </header>
                  )}
                  {/* When the row IS a boss, the party's other bosses are not repeated inside it:
                      listing them under this heading reads as though they were also this row. */}
                  <PartyCard party={party} bossByKey={bossByKey} hideBosses={boss !== null} />
                </article>
              );
            })}
          </div>
        </>
      )}
    </main>
  );
}
