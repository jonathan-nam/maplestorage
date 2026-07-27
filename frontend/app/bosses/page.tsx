"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect, useRef, useState } from "react";
import { BossMatrix } from "@/components/boss-matrix";
import { PlannerDock } from "@/components/planner-dock";
import { ResetTimer } from "@/components/reset-timer";
import { WeekStepper } from "@/components/week-stepper";
import { apiFetch } from "@/lib/api";
import { preloadBossArt } from "@/lib/preload-boss-art";
import { peek, put } from "@/lib/cache";
import type { Boss, BossClearsView } from "@/types/boss";
import type { Character } from "@/types/character";

type LoadState = "loading" | "loaded" | "error";

const BOSSES_KEY = "/api/bosses";
const CLEARS_KEY = "/api/bosses/clears";
const CHARACTERS_KEY = "/api/characters";

// Only the current view is cached. A past week is reached by a deliberate click and is worth a
// round-trip; caching every week stepped through would grow without bound for no visible gain.
const clearsUrl = (week: string | null) => (week ? `${CLEARS_KEY}?week=${week}` : CLEARS_KEY);

export default function BossesPage() {
  // Before anything is fetched: see lib/preload-boss-art.ts.
  preloadBossArt();

  const { getToken } = useAuth();

  // Seeded from cache so a repeat visit paints immediately rather than flashing a loading state
  // for data it already had. The fetch below still runs and overwrites. See lib/cache.ts.
  const seededBosses = peek<Boss[]>(BOSSES_KEY);
  const seededCharacters = peek<Character[]>(CHARACTERS_KEY);

  const [bosses, setBosses] = useState<Boss[]>(seededBosses ?? []);
  const [characters, setCharacters] = useState<Character[]>(seededCharacters ?? []);
  const [view, setView] = useState<BossClearsView | null>(peek<BossClearsView>(CLEARS_KEY) ?? null);
  // When the view was received, so the countdown can correct for a browser clock that disagrees
  // with the server's. See lib/reset-countdown.ts.
  const [receivedAt, setReceivedAt] = useState<number>(() => Date.now());
  const [state, setState] = useState<LoadState>(
    seededBosses && seededCharacters ? "loaded" : "loading",
  );
  const [week, setWeek] = useState<string | null>(null);
  const [stepping, setStepping] = useState(false);
  const [ticking, setTicking] = useState(false);
  const [uploadFor, setUploadFor] = useState<string | null>(null);

  // Clicking the arrow twice quickly fires two requests, and they can land in either order. Only
  // the newest one may write state, or the matrix ends up showing a week the label disagrees with.
  const latestRequest = useRef(0);

  async function loadClears(target: string | null, token?: string | null) {
    const ticket = ++latestRequest.current;
    const result = await apiFetch<BossClearsView>(
      clearsUrl(target),
      { method: "GET" },
      token !== undefined ? () => Promise.resolve(token) : getToken,
    );
    if (ticket !== latestRequest.current) return;
    setView(result);
    setReceivedAt(Date.now());
    if (target === null) put(CLEARS_KEY, result);
  }

  // After a capture saves, the matrix is stale. Only the clears can have changed, so only they are
  // refetched; the catalog and the roster are the same as they were a moment ago.
  async function refetchClears() {
    try {
      await loadClears(week);
    } catch {
      // The save itself succeeded, so leaving the old matrix up is better than blanking it. The
      // next load will pick the new clears up.
    }
  }

  /**
   * Answers one cell by hand, for when there is no planner capture to hand.
   *
   * Writes boss_clear, the same row a capture writes and Party View ticks, so the three cannot
   * drift. The server answers with the refreshed matrix: which period a tick lands in follows from
   * the boss's cadence and is decided there, so reading it back is what makes the screen show what
   * was written rather than what was clicked.
   *
   * Ticks serialise (see `ticking`). Two in flight at once could land in either order, and the
   * later answer is not necessarily the one that saw both writes.
   */
  async function toggleClear(characterId: string, bossKey: string, cleared: boolean) {
    const ticket = ++latestRequest.current;
    setTicking(true);
    try {
      const result = await apiFetch<BossClearsView>(
        CLEARS_KEY,
        { method: "PUT", body: JSON.stringify({ characterId, bossKey, cleared }) },
        getToken,
      );
      if (ticket !== latestRequest.current) return;
      setView(result);
      setReceivedAt(Date.now());
      put(CLEARS_KEY, result);
    } catch {
      // Leaving the old mark up beats drawing a tick that did not save.
    } finally {
      setTicking(false);
    }
  }

  async function selectWeek(target: string | null) {
    setStepping(true);
    try {
      await loadClears(target);
      setWeek(target);
    } catch {
      // Keep the week that is on screen. Moving the label without the data behind it would label
      // one week's marks with another week's date.
    } finally {
      setStepping(false);
    }
  }

  useEffect(() => {
    // One token for the whole burst. getToken() can round-trip to Clerk and that cost is paid
    // before each request goes out (see lib/api.ts), so three separate calls would pay it three
    // times. Mint once and share, as the inventory page does.
    getToken()
      .then((token) => {
        const withToken = () => Promise.resolve(token);
        return Promise.all([
          apiFetch<Boss[]>(BOSSES_KEY, { method: "GET" }, withToken),
          apiFetch<Character[]>(CHARACTERS_KEY, { method: "GET" }, withToken),
          loadClears(null, token),
        ]);
      })
      .then(([bossResult, characterResult]) => {
        setBosses(bossResult);
        setCharacters(characterResult);
        put(BOSSES_KEY, bossResult);
        put(CHARACTERS_KEY, characterResult);
        setState("loaded");
      })
      // Only show the error state if we have nothing at all: a failed refresh behind data we
      // already have should not blank the page.
      .catch(() => setState((s) => (s === "loaded" ? "loaded" : "error")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="page">
      <h1 className="page-title">Individual View</h1>
      {/* Kept to one line, and to about the same length as Party View's. The week label below
          sits at whatever height the prose above it wraps to, so an intro that runs onto a second
          line on one page and not the other moves the label when you switch between them. */}
      <p className="split-intro">Which bosses each character has cleared this period.</p>

      {state === "error" && <p>Couldn&apos;t load your boss clears.</p>}

      {/* The loading state IS the real matrix with shimmer in its cells, so the two cannot drift
          apart. A separate skeleton that restated the table's metrics by hand is exactly what put
          the inventory window 30px out of place (#77). */}
      {state === "loading" && (
        <BossMatrix loading bosses={bosses} characters={characters} clearsByCharacter={{}} />
      )}

      {state === "loaded" &&
        (characters.length === 0 ? (
          <p className="finder-empty">
            Add a character on the Inventory page to start tracking clears.
          </p>
        ) : (
          <>
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

            {/* Editable on the live view only, for the reason the dock below is only offered
                there: a past week carries weekly rows alone, so a tick on it would have no one
                period to land in. */}
            <BossMatrix
              bosses={bosses}
              characters={characters}
              clearsByCharacter={view?.clearsByCharacter ?? {}}
              historyWeek={view?.weekStart ?? null}
              onToggle={week === null ? toggleClear : undefined}
              busy={ticking || stepping}
            />

            {/* Uploading files a capture against now, so it only makes sense on the live view.
                Offering it under a past week would invite a capture that silently lands in this
                week instead of the one on screen. */}
            {week === null && (
              <PlannerDock
                characters={characters}
                selectedCharacterId={uploadFor}
                onSelectCharacter={setUploadFor}
                getToken={getToken}
                onSaved={refetchClears}
              />
            )}
          </>
        ))}
    </main>
  );
}
