"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useEffect, useState } from "react";
import { PartyCard } from "@/components/party-card";
import { ResetTimer } from "@/components/reset-timer";
import { RosterStrip } from "@/components/roster-strip";
import { apiAssetUrl, apiFetch } from "@/lib/api";
import { weekLabel } from "@/lib/boss-clears";
import { peek, put } from "@/lib/cache";
import { poolSize } from "@/lib/loot";
import {
  byBoss,
  byCharacter,
  type ClearFilter,
  consolidate,
  filterByClear,
  isCleared,
  otherMembers,
  partySizeLabel,
} from "@/lib/parties";
import { preloadBossArt } from "@/lib/preload-boss-art";
import type { Boss, BossClearsView } from "@/types/boss";
import type { Character } from "@/types/character";
import type { Party } from "@/types/party";

type LoadState = "loading" | "loaded" | "error";

// The same configs, read three ways, and none of them hides anything.
//   character   what does this character owe the week, a row per boss
//   boss        who am I doing Kalos with tonight
//   party       one row per ARRANGEMENT: a duo with the same person across three bosses is one
//               line with three bosses on it, which is how you would describe it out loud
type Grouping = "character" | "boss" | "party";

const PARTIES_KEY = "/api/parties";
const BOSSES_KEY = "/api/bosses";
const CHARACTERS_KEY = "/api/characters";
// Only for the countdown. The clears themselves are already on each config (party.cleared), read
// from the same boss_clear rows, so this is not a second source for what is done.
const CLEARS_KEY = "/api/bosses/clears";

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
  const [clearFilter, setClearFilter] = useState<ClearFilter>("all");
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<BossClearsView | null>(peek<BossClearsView>(CLEARS_KEY) ?? null);
  // When the view was received, so the countdown can correct for a browser clock that disagrees
  // with the server's. See lib/reset-countdown.ts.
  const [receivedAt, setReceivedAt] = useState<number>(() => Date.now());

  useEffect(() => {
    // One token for the whole burst, as the boss page does: getToken() can round-trip to Clerk,
    // and four calls would pay that four times.
    getToken()
      .then((token) => {
        const withToken = () => Promise.resolve(token);
        return Promise.all([
          apiFetch<Party[]>(PARTIES_KEY, { method: "GET" }, withToken),
          apiFetch<Boss[]>(BOSSES_KEY, { method: "GET" }, withToken),
          apiFetch<Character[]>(CHARACTERS_KEY, { method: "GET" }, withToken),
          // Caught on its own: the countdown is the one thing on this page that is not the party
          // list, and losing it must not take the list down with it.
          apiFetch<BossClearsView>(CLEARS_KEY, { method: "GET" }, withToken).catch(() => null),
        ]);
      })
      .then(([partyResult, bossResult, characterResult, clearsResult]) => {
        setParties(partyResult);
        setBosses(bossResult);
        setCharacters(characterResult);
        put(PARTIES_KEY, partyResult);
        put(BOSSES_KEY, bossResult);
        put(CHARACTERS_KEY, characterResult);
        if (clearsResult) {
          setView(clearsResult);
          setReceivedAt(Date.now());
          put(CLEARS_KEY, clearsResult);
        }
        setState("loaded");
      })
      // Only blank the page if there is nothing to show: a failed refresh behind data we already
      // have should leave that data up.
      .catch(() => setState((s) => (s === "loaded" ? "loaded" : "error")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Ticks a boss cleared, or un-ticks it.
   *
   * Writes boss_clear, the same row the Individual View matrix reads and a planner capture
   * overwrites, so the two pages cannot drift. Refetched rather than patched in place: the server
   * decides which period the tick landed in.
   */
  async function toggleClear(party: Party, cleared: boolean) {
    setBusy(true);
    try {
      await apiFetch<Party>(
        `${PARTIES_KEY}/${party.id}/clear`,
        { method: "PUT", body: JSON.stringify({ cleared }) },
        getToken,
      );
      const refreshed = await apiFetch<Party[]>(PARTIES_KEY, { method: "GET" }, getToken);
      setParties(refreshed);
      put(PARTIES_KEY, refreshed);
    } catch {
      // Leaving the old state up beats showing a tick that did not save.
    } finally {
      setBusy(false);
    }
  }

  const characterById = new Map(characters.map((c) => [c.id, c]));
  const bossByKey = new Map(bosses.map((b) => [b.bossKey, b]));

  // Filtered once, then grouped, so all three groupings answer the same question and a group with
  // nothing left in it drops out rather than sitting there empty.
  const visible = filterByClear(parties, clearFilter);
  const clearedCount = parties.filter(isCleared).length;
  const filterTabs: { value: ClearFilter; label: string; count: number }[] = [
    { value: "all", label: "All", count: parties.length },
    { value: "not-cleared", label: "Not cleared", count: parties.length - clearedCount },
    { value: "cleared", label: "Cleared", count: clearedCount },
  ];

  const characterGroups = byCharacter(
    visible,
    characters.map((c) => c.id),
  );
  const bossGroups = byBoss(visible, bosses);
  const arrangements = consolidate(
    visible,
    characters.map((c) => c.id),
  );

  return (
    <main className="page">
      <h1 className="page-title">Party View</h1>
      <p className="split-intro">Which bosses each character runs, and who they run them with.</p>

      {state === "error" && <p>Couldn&apos;t load your parties.</p>}
      {state === "loading" && <p className="party-hint">Loading...</p>}

      {state === "loaded" && (
        <>
          {/* The week these ticks are for, and how long is left of it: the same label and the
              same countdown the Individual View carries, off the same served week and instants.
              The label is drawn from weekLabel() rather than restated, so the two pages cannot
              word the same week differently.

              No ARROWS beside it, unlike the Individual View's. Stepping there refetches the
              matrix for the week you land on; nothing here can follow, because a config's clear
              comes off /api/parties, which only ever answers for the period it is in. Arrows
              would move the label while every tick under it stayed on this week, which is a
              confidently wrong screen rather than a missing feature. */}
          {view && (
            <div className="boss-controls">
              <span className="week-label" title="Party clears are shown for the current period">
                {weekLabel(view)}
              </span>
              <ResetTimer
                nextResets={view.nextResets}
                serverNow={view.now}
                receivedAt={receivedAt}
              />
            </div>
          )}

          <div className="party-toolbar">
            <div className="party-toolbar-tabs">
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
                <button
                  type="button"
                  className={grouping === "party" ? "basis-tab active" : "basis-tab"}
                  onClick={() => setGrouping("party")}
                >
                  By party
                </button>
              </div>

              {/* What is left this week, without reading past what is done. "Not cleared" holds
                  the unreported ones too: see isCleared. The counts are of every config, not of
                  what is on screen, so switching tabs cannot change them. */}
              <div className="basis-row" role="group" aria-label="Filter by clear state">
                {filterTabs.map((tab) => (
                  <button
                    key={tab.value}
                    type="button"
                    className={clearFilter === tab.value ? "basis-tab active" : "basis-tab"}
                    aria-pressed={clearFilter === tab.value}
                    onClick={() => setClearFilter(tab.value)}
                  >
                    {tab.label}
                    <span className="tab-count">{tab.count}</span>
                  </button>
                ))}
              </div>
            </div>
            <span className="party-toolbar-links">
              <Link className="party-cancel" href="/bosses/parties/wallet">
                Wallet
              </Link>
              <Link className="party-cancel" href="/bosses/parties/drops">
                Drop Log
              </Link>
              <Link className="party-cancel" href="/bosses/parties/edit">
                Edit parties
              </Link>
            </span>
          </div>

          {parties.length === 0 && (
            <p className="finder-empty">
              No parties yet. <Link href="/bosses/parties/edit">Set them up</Link>: pick a
              character, then say who they run each boss with.
            </p>
          )}

          {/* An empty list under a filter is an answer, not a blank page. Kept apart from the no
              parties at all case above, which is a different thing to say. */}
          {parties.length > 0 && visible.length === 0 && (
            <p className="finder-empty">
              {clearFilter === "cleared"
                ? "Nothing cleared this week yet."
                : "Every party is cleared this week."}
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
                      <PartyCard
                        key={party.id}
                        party={party}
                        busy={busy}
                        onToggleClear={(cleared) => toggleClear(party, cleared)}
                        heading={
                          <>
                            {bossByKey.get(party.bossKey)?.iconUrl && (
                              <img
                                className="boss-portrait"
                                src={apiAssetUrl(bossByKey.get(party.bossKey)!.iconUrl!)}
                                alt=""
                              />
                            )}
                            <h3 className="party-row-name">
                              {bossByKey.get(party.bossKey)?.name ?? party.bossKey}
                            </h3>
                          </>
                        }
                      />
                    ))}
                  </div>
                </section>
              );
            })}

          {grouping === "party" &&
            arrangements.map((arrangement) => {
              const character = characterById.get(arrangement.characterId);
              const others = otherMembers({
                ...arrangement.parties[0]!,
                members: arrangement.members,
              });
              return (
                <article className="boss-run" key={arrangement.key}>
                  <header className="boss-run-head">
                    {character?.spriteImgUrl && (
                      <img className="seat-sprite" src={character.spriteImgUrl} alt="" />
                    )}
                    <h3 className="boss-run-name">
                      {character?.name ?? "Unknown character"} +{" "}
                      {others.map((m) => m.name).join(" + ")}
                    </h3>
                    <span className="party-card-size">{partySizeLabel(others.length + 1)}</span>
                  </header>

                  <RosterStrip members={others} />

                  {/* One chip per boss this arrangement runs, each a way into that boss's own
                      pool. The pools stay separate: a drop comes off one boss, and pooling three
                      would be splitting what cannot be split. */}
                  <ul className="party-bosses">
                    {arrangement.parties.map((party) => (
                      <li key={party.id}>
                        <Link href={`/bosses/parties/${party.id}`}>
                          {bossByKey.get(party.bossKey)?.iconUrl && (
                            <img
                              className="boss-portrait"
                              src={apiAssetUrl(bossByKey.get(party.bossKey)!.iconUrl!)}
                              alt=""
                            />
                          )}
                          {bossByKey.get(party.bossKey)?.name ?? party.bossKey}
                          {/* Both states are said out loud. "done" alone left "still to do" as the
                              absence of a label, which is the one state on this page you actually
                              need to spot. Null stays silent: it is not a third answer here, it is
                              no answer. */}
                          {party.cleared !== null && (
                            <span
                              className={`party-clear is-${party.cleared ? "cleared" : "pending"}`}
                            >
                              {party.cleared ? "done" : "still to do"}
                            </span>
                          )}
                          {/* Every drop, not just the outstanding ones: this is the way in to
                              the pool, and it disappeared entirely once everything was paid. */}
                          {poolSize(party) > 0 && (
                            <span
                              className={
                                party.pendingLoot + party.awaitingPayout > 0
                                  ? "party-loot-summary"
                                  : "party-loot-summary is-done"
                              }
                            >
                              {poolSize(party)}
                            </span>
                          )}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </article>
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
                    <PartyCard
                      key={party.id}
                      party={party}
                      busy={busy}
                      onToggleClear={(cleared) => toggleClear(party, cleared)}
                      heading={
                        <>
                          {characterById.get(party.characterId)?.spriteImgUrl && (
                            <img
                              className="seat-sprite"
                              src={characterById.get(party.characterId)!.spriteImgUrl!}
                              alt=""
                            />
                          )}
                          <h3 className="party-row-name">
                            {characterById.get(party.characterId)?.name ?? "Unknown character"}
                          </h3>
                        </>
                      }
                    />
                  ))}
                </div>
              </section>
            ))}
        </>
      )}
    </main>
  );
}
