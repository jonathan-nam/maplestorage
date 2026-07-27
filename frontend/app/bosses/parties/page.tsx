"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { PartyCard } from "@/components/party-card";
import { ResetTimer } from "@/components/reset-timer";
import { WeekStepper } from "@/components/week-stepper";
import { RosterStrip } from "@/components/roster-strip";
import { apiAssetUrl, apiFetch } from "@/lib/api";
import { cellState, clearStateLabel, indexClears } from "@/lib/boss-clears";
import { peek, put } from "@/lib/cache";
import { poolSize } from "@/lib/loot";
import {
  byBoss,
  byCharacter,
  type ClearFilter,
  consolidate,
  existedInWeek,
  filterByClear,
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
// The countdown, the week being shown, AND the clears for a past week. On the live view a config
// carries its own answer (party.cleared) and that is what is drawn; only a history view reads the
// clears out of here, because /api/parties can only ever answer for the period it is in.
const CLEARS_KEY = "/api/bosses/clears";

// Only the live view is cached. A past week is a deliberate click and worth a round-trip, and
// caching every week stepped through would grow without bound. Same reasoning as the boss page.
const clearsUrl = (week: string | null) => (week ? `${CLEARS_KEY}?week=${week}` : CLEARS_KEY);

/**
 * A past week can only answer for WEEKLY bosses.
 *
 * The server returns weekly rows alone for a history view, so a monthly config in a past week has
 * no row and would draw as "not reported" when the truth is that nobody asked. Dropping those
 * configs is what the matrix does with its monthly and daily bands, for the same reason.
 */
const WEEKLY = "WEEKLY";

/** "1 config is" / "3 configs are", so the history note reads as a sentence at either count. */
const configsAre = (n: number) => `${n} ${n === 1 ? "config is" : "configs are"}`;

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
  // null is the live view. Anything else is a past week, read-only.
  const [week, setWeek] = useState<string | null>(null);
  const [stepping, setStepping] = useState(false);

  // Stepping twice quickly fires two requests that can land in either order. Only the newest may
  // write state, or the list ends up showing a week the label disagrees with. Same guard as the
  // boss page.
  const latestClears = useRef(0);

  async function loadClears(target: string | null, token?: string | null) {
    const ticket = ++latestClears.current;
    const result = await apiFetch<BossClearsView>(
      clearsUrl(target),
      { method: "GET" },
      token !== undefined ? () => Promise.resolve(token) : getToken,
    );
    if (ticket !== latestClears.current) return;
    setView(result);
    setReceivedAt(Date.now());
    if (target === null) put(CLEARS_KEY, result);
  }

  async function selectWeek(target: string | null) {
    setStepping(true);
    try {
      await loadClears(target);
      setWeek(target);
    } catch {
      // Keep the week on screen. Moving the label without the clears behind it would label one
      // week's ticks with another week's date.
    } finally {
      setStepping(false);
    }
  }

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
          // Through loadClears so this first read takes a ticket like any other. Stepping
          // immediately after opening the page would otherwise have the initial answer land last
          // and overwrite the week you asked for.
          //
          // Caught on its own: the clears are the one thing on this page that is not the party
          // list, and losing them must not take the list down with it.
          loadClears(null, token).catch(() => null),
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
  const history = week !== null;

  // Two rules narrow a past week, and they are counted apart so the note can say which one dropped
  // what. Pooling them would explain four absent rows with a rule that accounts for one.
  //
  // Cadence first: a history view carries weekly rows only, so the configs it cannot answer for are
  // dropped rather than drawn as "not reported". See WEEKLY above.
  const weekly = history
    ? parties.filter((p) => bossByKey.get(p.bossKey)?.reset === WEEKLY)
    : parties;
  // Then age, which is existedInWeek's job: today's configs are not last week's parties.
  const shown = week !== null ? existedInWeek(weekly, week) : weekly;
  const hiddenByCadence = parties.length - weekly.length;
  const hiddenByAge = weekly.length - shown.length;

  // Why a week came out empty, so the blank list is a reason rather than a shrug. Both rules can
  // empty it, and naming the wrong one is a confident wrong explanation of a correct screen.
  const emptyWeekReason =
    hiddenByCadence === 0
      ? "they were all set up after it"
      : hiddenByAge === 0
        ? "none of them are on a weekly boss"
        : "some were set up after it, and the rest are not on weekly bosses";

  const clearsByCharacter = new Map(
    Object.entries(view?.clearsByCharacter ?? {}).map(([id, clears]) => [id, indexClears(clears)]),
  );

  /**
   * What this config's clear tick should say.
   *
   * On the live view that is the config's own answer, straight off /api/parties. On a past week it
   * has to come from the clears the stepper just fetched, because /api/parties only ever answers
   * for the period it is in: reading party.cleared there would label last week's row with this
   * week's state. `byHand` is false on a history view rather than guessed, since the clears
   * endpoint does not carry the provenance the config does.
   */
  function clearOf(party: Party): { cleared: boolean | null; byHand: boolean } {
    if (!history) return { cleared: party.cleared, byHand: party.clearedByHand };
    const state = cellState(clearsByCharacter.get(party.characterId), party.bossKey);
    return { cleared: state === "unseen" ? null : state === "cleared", byHand: false };
  }

  // The clear the page is DRAWING, not the config's own, so the filter and the counts agree with
  // the ticks on a past week instead of narrowing by this week's state.
  const showsCleared = (party: Party) => clearOf(party).cleared === true;

  // Filtered by week first, then by clear state, then grouped, so all three groupings answer the
  // same question and a group with nothing left in it drops out rather than sitting there empty.
  const visible = filterByClear(shown, clearFilter, showsCleared);
  const clearedCount = shown.filter(showsCleared).length;
  const filterTabs: { value: ClearFilter; label: string; count: number; title?: string }[] = [
    { value: "all", label: "All", count: shown.length },
    {
      value: "not-cleared",
      label: "Not cleared",
      count: shown.length - clearedCount,
      title: "Includes bosses no planner capture has mentioned this period",
    },
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
      {/* Kept to one line, and to about the same length as the Individual View's, for the reason
          given there: the week label below sits at whatever height this wraps to. */}
      <p className="split-intro">Which bosses each character runs, and who they run them with.</p>

      {state === "error" && <p>Couldn&apos;t load your parties.</p>}
      {state === "loading" && <p className="party-hint">Loading...</p>}

      {state === "loaded" && (
        <>
          {/* The same controls the Individual View carries, in the same order and the same row:
              the stepper on the left, the countdown on the right. The WeekStepper component
              itself, not a copy of its label, so the two pages cannot drift in wording, spacing
              or behaviour.

              Stepping refetches the clears and the ticks follow it, which is the only reason the
              arrows are allowed to be here: a label that moved while the ticks stayed on this
              week would be a confidently wrong screen. See clearOf(). */}
          {view && (
            <div className="boss-controls">
              <WeekStepper view={view} onSelect={selectWeek} busy={stepping} />
              <ResetTimer
                nextResets={view.nextResets}
                serverNow={view.now}
                receivedAt={receivedAt}
              />
            </div>
          )}

          {/* Said out loud rather than left to be noticed: a past week is read-only, and it is
              short some configs. Each reason gets its own count, so neither is explained by the
              other's rule. */}
          {history && (
            <p className="boss-history-note">
              A past week. Clears are read-only here, and only weekly bosses can be answered for
              {hiddenByCadence > 0 && `, so ${configsAre(hiddenByCadence)} not shown`}.
              {hiddenByAge > 0 &&
                ` ${configsAre(hiddenByAge)} not shown either, having been set up after this week.`}
              {/* The one thing on a past week that is still today's answer. A clear is history,
                  keyed on the character and the boss and the period; a roster is configuration, and
                  editing one rewrites who is drawn beside every past clear it appears next to.
                  Said rather than snapshotted: a planner capture never knew who was in the party,
                  so storing one per week would file today's guess as that week's fact. */}
              {shown.length > 0 &&
                " Rosters are the current ones, since a config records who you run with now rather" +
                  " than who was there that week."}
            </p>
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
                  the unreported ones too. The counts do not move when you switch tabs: they are of
                  every config the WEEK admits, which on the live view is all of them and on a past
                  week is the weekly ones. Counting past that would offer a tab that lists less
                  than it promises. */}
              <div className="basis-row" role="group" aria-label="Filter by clear state">
                {filterTabs.map((tab) => (
                  <button
                    key={tab.value}
                    type="button"
                    className={clearFilter === tab.value ? "basis-tab active" : "basis-tab"}
                    aria-pressed={clearFilter === tab.value}
                    title={tab.title}
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

          {/* A past week the configs do not reach is its own answer, and NOT "nothing cleared".
              Nothing was cleared BY THESE PARTIES because these parties did not exist; the clears
              that week are real and the Individual View still has them. */}
          {parties.length > 0 && shown.length === 0 && (
            <p className="finder-empty">No parties in this week: {emptyWeekReason}.</p>
          )}

          {/* An empty list under a filter is an answer, not a blank page. Kept apart from the no
              parties at all case above, which is a different thing to say. */}
          {shown.length > 0 && visible.length === 0 && (
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
                        clear={clearOf(party)}
                        onToggleClear={
                          history ? undefined : (cleared) => toggleClear(party, cleared)
                        }
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
                          {/* Both states are said out loud. Naming only the cleared one left the
                              other as the absence of a label, which is the one state on this page
                              you actually need to spot. Null stays silent: it is not a third answer
                              here, it is no answer. */}
                          {clearOf(party).cleared !== null && (
                            <span
                              className={`party-clear is-${
                                clearOf(party).cleared ? "cleared" : "pending"
                              }`}
                            >
                              {clearStateLabel(clearOf(party).cleared)}
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
                      clear={clearOf(party)}
                      onToggleClear={history ? undefined : (cleared) => toggleClear(party, cleared)}
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
