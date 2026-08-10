"use client";

import { PAGE_WAITING, WaitingNote } from "@/components/route-loading";
import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AddForWeek } from "@/components/add-for-week";
import { ArrangementCard } from "@/components/arrangement-card";
import { KnownCharacters } from "@/components/known-characters";
import { PartyCard } from "@/components/party-card";
import { ResetTimer } from "@/components/reset-timer";
import { WeekStepper } from "@/components/week-stepper";
import { ApiError, apiAssetUrl, apiFetch } from "@/lib/api";
import { cellState, clearOfCell, clearStateLabel, indexClears } from "@/lib/boss-clears";
import { bossLabel, difficultyLabel } from "@/lib/boss-difficulty";
import { peek, put } from "@/lib/cache";
import { buildDropLog, couponsOwedByParty } from "@/lib/drop-log";
import { poolSize } from "@/lib/loot";
import {
  byBoss,
  byCharacter,
  type ClearFilter,
  consolidate,
  existedInWeek,
  filterByClear,
  knownCharacterNames,
  otherMembers,
  runningThisPeriod,
} from "@/lib/parties";
import { preloadBossArt } from "@/lib/preload-boss-art";
import { type CrossedReset, WEEKLY_CADENCE } from "@/lib/reset-countdown";
import { useSeatSprites } from "@/lib/seat-sprites";
import { useAccountSettings } from "@/lib/use-account-settings";
import { useRowWrites } from "@/lib/use-row-writes";
import { offersWallet } from "@/lib/world";
import type { Boss, BossClearsView } from "@/types/boss";
import type { Character } from "@/types/character";
import type { DropTables } from "@/types/drop";
import type { AddLootBody, PartyLootPool } from "@/types/loot";
import type {
  Party,
  Person,
  SavePartyBody,
  SaveWeekRosterBody,
  SetPartySkipBody,
} from "@/types/party";

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
// Whose character is whose, for the roster editor's datalist. Same key as the edit page, so the
// two share one cached copy and offer the same spellings.
const PEOPLE_KEY = "/api/people";
// The countdown, the week being shown, AND the clears for a past week. On the live view a config
// carries its own answer (party.cleared) and that is what is drawn; only a history view reads the
// clears out of here, because /api/parties can only ever answer for the period it is in.
const CLEARS_KEY = "/api/bosses/clears";
// The whole catalog's drop tables, so a row can open its picker without a round-trip. Same key as
// the party page, so the two share one cached copy.
const DROPS_KEY = "/api/bosses/drops";
// Every pool, for the coupons-owed figure on a row. Same key as the Drop Log, so the two share one
// cached copy and cannot disagree about what is owed.
const POOLS_KEY = "/api/parties/loot";

// Both lists take the week. The clears draw a past week's ticks, and the party list carries that
// week's drop counts, so the badge beside a tick answers for the same week the tick does.
//
// Only the live view is cached. A past week is a deliberate click and worth a round-trip, and
// caching every week stepped through would grow without bound. Same reasoning as the boss page.
const clearsUrl = (week: string | null) => (week ? `${CLEARS_KEY}?week=${week}` : CLEARS_KEY);
const partiesUrl = (week: string | null) => (week ? `${PARTIES_KEY}?week=${week}` : PARTIES_KEY);

// Rows are keyed by their config's id while they save. The one-off form is not a row, so it takes a
// name of its own: it is one more thing that can be mid-save. See lib/use-row-writes.ts.
const ADD_FOR_WEEK = "add-for-week";

export default function PartiesPage() {
  // Before anything is fetched: see lib/preload-boss-art.ts.
  preloadBossArt();

  const { getToken } = useAuth();
  const settings = useAccountSettings();

  const seededParties = peek<Party[]>(PARTIES_KEY);
  const seededBosses = peek<Boss[]>(BOSSES_KEY);
  const seededCharacters = peek<Character[]>(CHARACTERS_KEY);

  const [parties, setParties] = useState<Party[]>(seededParties ?? []);
  const [bosses, setBosses] = useState<Boss[]>(seededBosses ?? []);
  const [characters, setCharacters] = useState<Character[]>(seededCharacters ?? []);
  const [dropTables, setDropTables] = useState<DropTables>(peek<DropTables>(DROPS_KEY) ?? {});
  const [people, setPeople] = useState<Person[]>(peek<Person[]>(PEOPLE_KEY) ?? []);
  const [pools, setPools] = useState<PartyLootPool[]>(peek<PartyLootPool[]>(POOLS_KEY) ?? []);
  const [state, setState] = useState<LoadState>(
    seededParties && seededBosses && seededCharacters ? "loaded" : "loading",
  );
  const [grouping, setGrouping] = useState<Grouping>("character");
  const [clearFilter, setClearFilter] = useState<ClearFilter>("all");
  // Per row, so a tick on one boss does not grey out every other row's controls. One write at a
  // time still, because each one refetches the list. See lib/use-row-writes.ts.
  const { isSaving, write } = useRowWrites();
  const [view, setView] = useState<BossClearsView | null>(peek<BossClearsView>(CLEARS_KEY) ?? null);
  // When the view was received, so the countdown can correct for a browser clock that disagrees
  // with the server's. See lib/reset-countdown.ts.
  const [receivedAt, setReceivedAt] = useState<number>(() => Date.now());
  // null is the live view. Anything else is a past week, read-only.
  const [week, setWeek] = useState<string | null>(null);
  const [stepping, setStepping] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  // Whether anything, in any week, still owes somebody. Held apart from `parties` because that
  // list is now scoped to the week on screen: a share owed on a drop from three weeks ago is still
  // a share owed, and stepping back must not retire the link to where it is settled. Written on
  // the live view only, which is the one that carries every outstanding drop forward.
  const [owedAnywhere, setOwedAnywhere] = useState(() =>
    (seededParties ?? []).some((p) => p.awaitingPayout > 0),
  );

  // The seats are drawn on the party page, which is a click from here. See lib/seat-sprites.ts.
  useSeatSprites(parties);

  // Stepping twice quickly fires two requests that can land in either order. Only the newest may
  // write state, or the list ends up showing a week the label disagrees with. Same guard as the
  // boss page, and one ticket for both lists so they cannot land out of step with each other.
  const latestWeek = useRef(0);

  /**
   * The week's two lists, under one ticket.
   *
   * Answers whether the week label may move, as the boss page's loader does: a response overtaken
   * by a newer step must move neither the label nor the lists.
   *
   * `clearsOptional` is the first load alone. Losing the clears there costs the stepper and the
   * countdown and nothing else, and blanking the party list over that says less than leaving it up.
   * A step is both or neither: badges from one week under a label from another is exactly the
   * confidently wrong screen this guard exists to prevent.
   */
  async function loadWeek(
    target: string | null,
    opts: { token?: string | null; clearsOptional?: boolean } = {},
  ): Promise<boolean> {
    const { token, clearsOptional } = opts;
    const auth = token !== undefined ? () => Promise.resolve(token) : getToken;
    const ticket = ++latestWeek.current;
    const clearsRequest = apiFetch<BossClearsView>(clearsUrl(target), { method: "GET" }, auth);
    const [clears, partyList] = await Promise.all([
      clearsOptional ? clearsRequest.catch(() => null) : clearsRequest,
      apiFetch<Party[]>(partiesUrl(target), { method: "GET" }, auth),
    ]);
    if (ticket !== latestWeek.current) return false;

    setParties(partyList);
    if (target === null) {
      // The live view is the one that carries every outstanding drop forward, so it is the only
      // answer to "is any money owed at all". See owedAnywhere.
      setOwedAnywhere(partyList.some((p) => p.awaitingPayout > 0));
      put(PARTIES_KEY, partyList);
    }
    if (!clears) return false;
    setView(clears);
    setReceivedAt(Date.now());
    if (target === null) put(CLEARS_KEY, clears);
    return true;
  }

  async function selectWeek(target: string | null) {
    setStepping(true);
    try {
      if (await loadWeek(target)) setWeek(target);
    } catch {
      // Keep the week on screen. Moving the label without the lists behind it would label one
      // week's ticks and badges with another week's date.
    } finally {
      setStepping(false);
    }
  }

  /**
   * Picks the new period up when a reset passes under an open tab. See ResetTimer.
   *
   * A weekly reset takes the list back to the current week, the way the in-game planner comes back
   * cleared rather than still showing the week you had open. Every other cadence refreshes the
   * week on screen and leaves it there, since a daily boundary says nothing about that week.
   *
   * Both lists either way, because the page draws its ticks from whichever one the week calls for:
   * the live view reads party.cleared, a past week reads the clears. Refreshing one would leave
   * the other answering for the period that just ended.
   *
   * Which configs there are is untouched by a reset (the party table has no period). What changes
   * for them is the clear each one carries, back to "nobody has said anything yet", and the drop
   * counts, since a settled pool belongs to the week it settled in.
   */
  async function pickUpReset(crossed: CrossedReset) {
    const target = crossed.cadences.includes(WEEKLY_CADENCE) ? null : week;
    setStepping(true);
    try {
      if (await loadWeek(target)) setWeek(target);
    } catch {
      // The old list under a rolled-over week is wrong, but blanking the page says less than
      // leaving it up. The next visit or step reloads it.
    } finally {
      setStepping(false);
    }
  }

  useEffect(() => {
    // One token for the whole burst, as the boss page does: getToken() can round-trip to Clerk,
    // and three calls would pay that three times.
    getToken()
      .then((token) => {
        const withToken = () => Promise.resolve(token);
        return Promise.all([
          // Through loadWeek so this first read takes a ticket like any other. Stepping
          // immediately after opening the page would otherwise have the initial answer land last
          // and overwrite the week you asked for.
          loadWeek(null, { token, clearsOptional: true }),
          apiFetch<Boss[]>(BOSSES_KEY, { method: "GET" }, withToken),
          apiFetch<Character[]>(CHARACTERS_KEY, { method: "GET" }, withToken),
          // Optional, for the same reason the clears are on the first load: losing them costs the
          // row's drop picker and nothing else, and blanking a page that answers "what is left
          // this week" over a picker's data says less than leaving it up.
          apiFetch<DropTables>(DROPS_KEY, { method: "GET" }, withToken).catch(() => null),
          // Optional too. Losing it costs the roster editor's suggestions, and a name can still
          // be typed out.
          apiFetch<Person[]>(PEOPLE_KEY, { method: "GET" }, withToken).catch(() => null),
          // Optional, for the coupons-owed figure on a row. Losing it costs that one number, and
          // a row that says nothing about coupons beats a page that says nothing at all.
          apiFetch<PartyLootPool[]>(POOLS_KEY, { method: "GET" }, withToken).catch(() => null),
        ]);
      })
      .then(([, bossResult, characterResult, dropResult, peopleResult, poolResult]) => {
        setBosses(bossResult);
        setCharacters(characterResult);
        put(BOSSES_KEY, bossResult);
        put(CHARACTERS_KEY, characterResult);
        if (dropResult) {
          setDropTables(dropResult);
          put(DROPS_KEY, dropResult);
        }
        if (peopleResult) {
          setPeople(peopleResult);
          put(PEOPLE_KEY, peopleResult);
        }
        if (poolResult) {
          setPools(poolResult);
          put(POOLS_KEY, poolResult);
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
    try {
      await write(party.id, async () => {
        await apiFetch<Party>(
          `${PARTIES_KEY}/${party.id}/clear`,
          { method: "PUT", body: JSON.stringify({ cleared }) },
          getToken,
        );
        const refreshed = await apiFetch<Party[]>(PARTIES_KEY, { method: "GET" }, getToken);
        setParties(refreshed);
        put(PARTIES_KEY, refreshed);
      });
    } catch {
      // Leaving the old state up beats showing a tick that did not save.
    }
  }

  /**
   * Sets who ran THIS week, or puts the week back to the usual party with null.
   *
   * Not the config's own roster: that is the edit page's, and changing it here would rewrite every
   * week rather than the one on screen. The week is left off the body on purpose, so the server's
   * clock decides which one this is.
   *
   * Live view only, so PARTIES_KEY is the right list to refetch. Throws on failure, which is what
   * lets the row show the server's reason.
   */
  async function saveRoster(party: Party, members: string[] | null) {
    await write(party.id, async () => {
      await apiFetch<Party>(
        `${PARTIES_KEY}/${party.id}/roster`,
        { method: "PUT", body: JSON.stringify({ members } satisfies SaveWeekRosterBody) },
        getToken,
      );
      const refreshed = await apiFetch<Party[]>(PARTIES_KEY, { method: "GET" }, getToken);
      setParties(refreshed);
      put(PARTIES_KEY, refreshed);
    });
  }

  /**
   * Takes a boss off this period, or puts it back, leaving the config alone.
   *
   * A week off is not the party ending, so nothing is deleted: the seats, the pool and the standing
   * roster all survive it, and next period runs as usual without being told to. The row leaves the
   * list, and the count above it is what says so.
   *
   * Live view only, so PARTIES_KEY is the right list to refetch. Throws on failure, which is what
   * lets the row show it did not save.
   */
  async function setSkipped(party: Party, skipped: boolean) {
    await write(party.id, async () => {
      await apiFetch<Party>(
        `${PARTIES_KEY}/${party.id}/skip`,
        { method: "PUT", body: JSON.stringify({ skipped } satisfies SetPartySkipBody) },
        getToken,
      );
      const refreshed = await apiFetch<Party[]>(PARTIES_KEY, { method: "GET" }, getToken);
      setParties(refreshed);
      put(PARTIES_KEY, refreshed);
    });
  }

  /**
   * Adds a boss for this period alone.
   *
   * A one-off, not a config: it is on the week you are looking at and gone from the next one with
   * nobody saying so. The server arms the config a spent one-off already left behind rather than
   * making a second one for the pair, so running the same boss again a month later lands in the
   * same pool.
   */
  async function addOneOff(body: SavePartyBody) {
    setAddError(null);
    try {
      await write(ADD_FOR_WEEK, async () => {
        await apiFetch<Party>(
          PARTIES_KEY,
          { method: "POST", body: JSON.stringify(body) },
          getToken,
        );
        const refreshed = await apiFetch<Party[]>(PARTIES_KEY, { method: "GET" }, getToken);
        setParties(refreshed);
        put(PARTIES_KEY, refreshed);
      });
    } catch (e) {
      // The server's own reason. It is the only part of a refusal you can act on.
      setAddError(e instanceof ApiError ? e.body : "Couldn't add that boss.");
    }
  }

  /**
   * Logs a drop from the row, without leaving the list.
   *
   * The pool it lands in is the party page's, the same POST that page makes, so a drop added here
   * and one added there are the same row. The counts are refetched rather than incremented in
   * place: which of the three a drop counts towards is the server's to derive.
   *
   * Live view only, so PARTIES_KEY is the right list to refetch and to cache. See onAddDrop.
   * Throws on failure, which is what makes the row say so.
   */
  async function addDrop(party: Party, body: AddLootBody) {
    await write(party.id, async () => {
      await apiFetch<unknown>(
        `${PARTIES_KEY}/${party.id}/loot`,
        { method: "POST", body: JSON.stringify(body) },
        getToken,
      );
      const refreshed = await apiFetch<Party[]>(PARTIES_KEY, { method: "GET" }, getToken);
      setParties(refreshed);
      put(PARTIES_KEY, refreshed);
    });
  }

  const characterById = new Map(characters.map((c) => [c.id, c]));
  const bossByKey = new Map(bosses.map((b) => [b.bossKey, b]));
  // Coupons somebody else is holding for you, per party. Through the Drop Log's own entries so the
  // badge and the log cannot disagree about what you are owed, rather than counted again here.
  const couponsOwed = couponsOwedByParty(buildDropLog(parties, pools, dropTables).entries);
  const history = week !== null;

  // No tables, no picker. Offering one without them would list nothing and then explain the empty
  // list as "no drop table recorded for this boss", which is a statement about the catalog we
  // would not be in a position to make. The link into the party is still there either way.
  const haveDropTables = Object.keys(dropTables).length > 0;
  // Never on a past week: the server stamps a drop with today, so one added under last week's
  // label would land in a week this screen is not showing.
  const canAddDrops = !history && haveDropTables;
  // The names already spelled somewhere, for the editor's datalist. Built from what the page has:
  // people is optional, and its absence costs suggestions rather than the editor.
  const knownCharacters = knownCharacterNames(characters, people, parties);

  // Two rules narrow a past week, counted apart so the empty line can name the one that applies.
  //
  // Cadence first: the server returns weekly rows alone for a history view, so a monthly config in
  // a past week has no row and would draw as "not reported" when the truth is that nobody asked.
  // Dropping those configs is what the matrix does with its monthly and daily bands.
  const weekly = history
    ? parties.filter((p) => bossByKey.get(p.bossKey)?.reset === WEEKLY_CADENCE)
    : parties;
  // Then age, which is existedInWeek's job: today's configs are not last week's parties.
  const shown = week !== null ? existedInWeek(weekly, week) : weekly;
  const hiddenByCadence = parties.length - weekly.length;
  const hiddenByAge = weekly.length - shown.length;
  // Last, what was taken off this period by hand. Held apart from the two rules above because those
  // are about the week and this is about the boss: a config taken off is in the week, it is just not
  // being run in it. Everything below counts `running`, so a boss taken off is out of the tabs and
  // out of the group headings as well as out of the list.
  const running = runningThisPeriod(shown);

  // Either rule can empty a week, and naming the wrong one explains a correct screen wrongly. Only
  // for a week with nothing left in it: a week that still has a list says nothing about what it
  // narrowed, since the list IS the answer.
  const emptyWeekReason =
    hiddenByCadence === 0
      ? "They were all set up later."
      : hiddenByAge === 0
        ? "None are on a weekly boss."
        : "They were set up later, or are not on a weekly boss.";

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
    return { cleared: clearOfCell(state), byHand: false };
  }

  // The clear the page is DRAWING, not the config's own, so the filter and the counts agree with
  // the ticks on a past week instead of narrowing by this week's state.
  const showsCleared = (party: Party) => clearOf(party).cleared === true;

  // Filtered by week first, then by clear state, then grouped, so all three groupings answer the
  // same question and a group with nothing left in it drops out rather than sitting there empty.
  const visible = filterByClear(running, clearFilter, showsCleared);
  const clearedCount = running.filter(showsCleared).length;
  const filterTabs: { value: ClearFilter; label: string; count: number; title?: string }[] = [
    { value: "all", label: "All", count: running.length },
    {
      value: "not-cleared",
      label: "Not cleared",
      count: running.length - clearedCount,
      title: "Includes bosses no planner capture has mentioned this period",
    },
    { value: "cleared", label: "Cleared", count: clearedCount },
  ];

  const showWallet = offersWallet(settings?.trades, owedAnywhere);

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
    <main className={state === "loading" ? PAGE_WAITING : "page"}>
      {/* Beside the title, not among the tabs below: those pick what the list shows, so a link
          that leaves the page read as another one of them. */}
      <div className="page-head">
        <h1 className="page-title">Party View</h1>
        {state === "loaded" && (
          <span className="page-head-links">
            {showWallet && (
              <Link className="party-cancel" href="/bosses/parties/wallet">
                Wallet
              </Link>
            )}
            {/* Kept beside the Wallet even though the Drop Log is on the menu now: it is one
                click from the parties whose drops it holds, and that is where it is wanted. */}
            <Link className="party-cancel" href="/bosses/drops">
              Drop Log
            </Link>
            <Link className="party-cancel" href="/bosses/parties/edit">
              Edit parties
            </Link>
          </span>
        )}
      </div>

      {state === "error" && <p>Couldn&apos;t load your parties.</p>}
      {state === "loading" && <WaitingNote />}

      {state === "loaded" && (
        <>
          {/* Once for the page, not once per row: every roster editor points at this one id. */}
          <KnownCharacters names={knownCharacters} />
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
                onReset={pickUpReset}
              />
            </div>
          )}

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

            {/* What is left this week, without reading past what is done. "Not cleared" holds the
                unreported ones too. The counts do not move when you switch tabs: they are of every
                config being RUN in the week, which on the live view is all of them bar the ones
                taken off and on a past week is the weekly ones. Counting past that would offer a tab
                that lists less than it promises. */}
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

          {parties.length === 0 && (
            <p className="finder-empty">
              No parties yet. <Link href="/bosses/parties/edit">Set them up</Link>: pick a
              character, then say who they run each boss with.
            </p>
          )}

          {/* Not "nothing cleared": that week's clears are real and the Individual View has them.
              These parties just were not around for it. */}
          {parties.length > 0 && shown.length === 0 && (
            <p className="finder-empty">No parties in this week. {emptyWeekReason}</p>
          )}

          {/* Live view only. The server writes a one-off into the period its own clock is in, so
              offering this under a past week's label would file the night in a week the screen is
              not showing. Same rule as the drop picker. */}
          {!history && characters.length > 0 && (
            <AddForWeek
              characters={characters}
              bosses={bosses}
              parties={parties}
              busy={isSaving(ADD_FOR_WEEK)}
              error={addError}
              onAdd={addOneOff}
            />
          )}

          {shown.length > 0 && running.length === 0 && (
            <p className="finder-empty">
              {history ? (
                "Every boss was off that week."
              ) : (
                <>
                  Every boss is off this week. <Link href="/bosses/parties/edit">Put one back</Link>
                  .
                </>
              )}
            </p>
          )}

          {/* An empty list under a filter is an answer, not a blank page. Kept apart from the no
              parties at all case above, which is a different thing to say. */}
          {running.length > 0 && visible.length === 0 && (
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
                // A row of its own for the character, then its bosses under it at full width. The
                // sprite was tried beside the list, in a column of its own, and the list starting
                // 128px in cost more than the sprite gained.
                <section className="party-group" key={group.key}>
                  <header className="party-banner">
                    {/* The frame is drawn either way, so a roster where one lookup came back empty
                        does not go ragged around it. */}
                    {character?.spriteImgUrl ? (
                      <img className="party-banner-sprite" src={character.spriteImgUrl} alt="" />
                    ) : (
                      <span className="party-banner-sprite is-empty" aria-hidden="true" />
                    )}
                    <h2 className="party-group-name">{character?.name ?? "Unknown character"}</h2>
                    {/* Of what is listed below, not of what the character has: under a filter the
                        two differ, and the number that describes the rows you can see is the one
                        that cannot be read as a claim about the rows you cannot. */}
                    <span className="party-banner-count">
                      {group.parties.length} {group.parties.length === 1 ? "boss" : "bosses"}
                    </span>
                  </header>
                  <div className="party-list">
                    {group.parties.map((party) => (
                      <PartyCard
                        key={party.id}
                        party={party}
                        busy={isSaving(party.id)}
                        clear={clearOf(party)}
                        couponsOwed={couponsOwed.get(party.id) ?? 0}
                        onToggleClear={
                          history ? undefined : (cleared) => toggleClear(party, cleared)
                        }
                        dropTable={dropTables[party.bossKey]}
                        onAddDrop={canAddDrops ? (body) => addDrop(party, body) : undefined}
                        onSaveRoster={history ? undefined : (members) => saveRoster(party, members)}
                        onTakeOff={history ? undefined : () => setSkipped(party, true)}
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
                              {bossLabel(
                                bossByKey.get(party.bossKey)?.name ?? party.bossKey,
                                party.difficulty,
                              )}
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
                <ArrangementCard
                  key={arrangement.key}
                  sprite={character?.spriteImgUrl}
                  name={`${character?.name ?? "Unknown character"} + ${others
                    .map((m) => m.name)
                    .join(" + ")}`}
                  members={others}
                >
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
                          {bossLabel(
                            bossByKey.get(party.bossKey)?.name ?? party.bossKey,
                            party.difficulty,
                          )}
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
                </ArrangementCard>
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
                      busy={isSaving(party.id)}
                      clear={clearOf(party)}
                      couponsOwed={couponsOwed.get(party.id) ?? 0}
                      onToggleClear={history ? undefined : (cleared) => toggleClear(party, cleared)}
                      dropTable={dropTables[party.bossKey]}
                      onAddDrop={canAddDrops ? (body) => addDrop(party, body) : undefined}
                      onSaveRoster={history ? undefined : (members) => saveRoster(party, members)}
                      onTakeOff={history ? undefined : () => setSkipped(party, true)}
                      heading={
                        <>
                          {characterById.get(party.characterId)?.spriteImgUrl && (
                            <img
                              className="seat-sprite is-large"
                              src={characterById.get(party.characterId)!.spriteImgUrl!}
                              alt=""
                            />
                          )}
                          <h3 className="party-row-name">
                            {characterById.get(party.characterId)?.name ?? "Unknown character"}
                          </h3>
                          {/* Beside the character, not folded into the heading: filed by boss,
                              two of your characters can run the same boss at different modes. */}
                          {party.difficulty && (
                            <span className="party-difficulty">
                              {difficultyLabel(party.difficulty)}
                            </span>
                          )}
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
