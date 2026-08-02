"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useEffect, useState } from "react";

import { ResetTimer } from "@/components/reset-timer";
import { apiAssetUrl, apiFetch } from "@/lib/api";
import { progressLabel } from "@/lib/boss-clears";
import { type OutstandingCadence, outstandingByCadence } from "@/lib/boss-outstanding";
import { peek, put } from "@/lib/cache";
import { preloadBossArt } from "@/lib/preload-boss-art";
import type { Boss, BossClearsView } from "@/types/boss";
import type { Character } from "@/types/character";

type LoadState = "loading" | "loaded" | "error";

// The same keys the Individual View uses, so arriving there from here paints from cache rather
// than loading the three things this page has just fetched. See lib/cache.ts.
const BOSSES_KEY = "/api/bosses";
const CLEARS_KEY = "/api/bosses/clears";
const CHARACTERS_KEY = "/api/characters";

// Enough rows to read as a list rather than one lonely line, and it is what a roster with a
// routine set usually leaves standing on a Thursday.
const SKELETON_ROWS = 4;

/**
 * What the account still owes this period.
 *
 * The live period only: there is no week stepper here and no way to reach one. "What is left" is
 * not a question to ask of a week that has ended, and a past week cannot answer it for a monthly
 * anyway (see weeklyClearsFor).
 */
export function AccountOverview() {
  // Before anything is fetched: see lib/preload-boss-art.ts.
  preloadBossArt();

  const { getToken } = useAuth();

  // Seeded from cache so coming back from the matrix paints immediately instead of flashing a
  // loading state for data it already had. The fetch below still runs and overwrites.
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

  async function loadClears(token?: string | null) {
    const result = await apiFetch<BossClearsView>(
      CLEARS_KEY,
      { method: "GET" },
      token !== undefined ? () => Promise.resolve(token) : getToken,
    );
    setView(result);
    setReceivedAt(Date.now());
    put(CLEARS_KEY, result);
  }

  /**
   * Picks the new period up when a reset passes under an open tab.
   *
   * Reset writes nothing, so the period rolls over with no request having been made: a tab left
   * open would keep listing work that the reset has just replaced with a fresh set of it.
   */
  async function pickUpReset() {
    try {
      await loadClears();
    } catch {
      // The list on screen is a period out of date, which is better than blanking it. The next
      // load picks the new period up.
    }
  }

  useEffect(() => {
    // One token for the whole burst. getToken() can round-trip to Clerk and that cost is paid
    // before each request goes out (see lib/api.ts), so three separate calls would pay it three
    // times. Mint once and share, as the matrix does.
    getToken()
      .then((token) => {
        const withToken = () => Promise.resolve(token);
        return Promise.all([
          apiFetch<Boss[]>(BOSSES_KEY, { method: "GET" }, withToken),
          apiFetch<Character[]>(CHARACTERS_KEY, { method: "GET" }, withToken),
          loadClears(token),
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

  const cadences = outstandingByCadence(
    bosses,
    characters,
    view?.clearsByCharacter ?? {},
    view?.skipsByCharacter ?? {},
  );

  // Not "characters.length === 0": that is also true while the roster is still loading, when the
  // answer is "not yet" rather than "nobody".
  const noRoster = state !== "loading" && characters.length === 0;

  return (
    <>
      {view && (
        <ResetTimer
          nextResets={view.nextResets}
          serverNow={view.now}
          receivedAt={receivedAt}
          onReset={pickUpReset}
        />
      )}

      {state === "error" && <p className="finder-empty">Couldn&apos;t load your boss clears.</p>}

      {noRoster && (
        <p className="finder-empty">
          Add a character on the <Link href="/inventory">Inventory</Link> page to start tracking
          clears.
        </p>
      )}

      {/* The list needs saying which way round it is: a band reading "12/24 cleared" over a list
          of bosses is otherwise as readable as the twelve that are done. */}
      {!noRoster && state !== "error" && <h2 className="owed-heading">Still to run</h2>}

      {state === "loading" && <OutstandingBand loading />}

      {state === "loaded" &&
        !noRoster &&
        cadences.map((cadence) => <OutstandingBand key={cadence.cadence} cadence={cadence} />)}
    </>
  );
}

/**
 * One cadence's remaining runs, and the loading state of the same.
 *
 * The two are one component so they cannot drift apart in the way a hand-built skeleton did on the
 * inventory page (#77): the shimmer stands in the real row's places rather than restating its
 * metrics.
 */
function OutstandingBand({
  cadence,
  loading,
}: {
  cadence?: OutstandingCadence;
  loading?: boolean;
}) {
  // A band with nothing under it is not dropped. Its head still carries the count, and that count
  // IS the statement that there is nothing left, said in the numbers rather than in a sentence.
  const rows = cadence?.bosses ?? [];

  return (
    <section
      className="owed-band"
      role={loading ? "status" : undefined}
      aria-label={loading ? "Loading what is left to run" : undefined}
    >
      <h3 className="owed-cadence">
        {loading ? (
          <span className="skeleton sk-line" style={{ width: "70px" }} />
        ) : (
          <span>{cadence?.cadence}</span>
        )}
        {cadence && (
          <span className="owed-progress">
            {/* Never the bar alone. It is a second reading of the number beside it, so a
                proportion nobody can state has no bar. */}
            {cadence.progress.total ? (
              <span className="boss-progress-bar" aria-hidden="true">
                <span
                  style={{
                    width: `${(cadence.progress.cleared / cadence.progress.total) * 100}%`,
                  }}
                />
              </span>
            ) : null}
            {progressLabel(cadence.progress)}
          </span>
        )}
      </h3>

      <ul className="owed-list">
        {loading
          ? Array.from({ length: SKELETON_ROWS }, (_, i) => (
              <li className="owed-row" key={i}>
                <span className="owed-boss">
                  <span className="boss-portrait is-empty" aria-hidden="true" />
                  <span className="skeleton sk-line" style={{ width: "96px" }} />
                </span>
                <ul className="owed-runners">
                  <li>
                    <span className="skeleton sk-line" style={{ width: "140px" }} />
                  </li>
                </ul>
              </li>
            ))
          : rows.map(({ boss, runners }) => (
              <li className="owed-row" key={boss.bossKey}>
                <span className="owed-boss">
                  {/* The game's own portrait, so a row is recognisable before the name is read.
                      The frame is drawn either way, so a boss with no art keeps the column. */}
                  {boss.iconUrl ? (
                    <img className="boss-portrait" src={apiAssetUrl(boss.iconUrl)} alt="" />
                  ) : (
                    <span className="boss-portrait is-empty" aria-hidden="true" />
                  )}
                  <span className="owed-boss-name">{boss.name}</span>
                </span>
                {/* A list, so it is read as several characters owing one boss rather than as a
                    run of words after its name. It is also how many runs the row is worth. */}
                <ul className="owed-runners">
                  {runners.map((runner) => (
                    <li className="owed-runner" key={runner.id}>
                      {runner.spriteImgUrl ? (
                        <img className="owed-sprite" src={runner.spriteImgUrl} alt="" />
                      ) : (
                        <span className="owed-sprite is-empty" aria-hidden="true" />
                      )}
                      {runner.name}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
      </ul>
    </section>
  );
}
