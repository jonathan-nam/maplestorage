"use client";

import { type CSSProperties, useState } from "react";

import { apiAssetUrl } from "@/lib/api";
import {
  cellState,
  cellStateLabel,
  clearOfCell,
  clearProgress,
  formatPeriod,
  indexClears,
  indexSkips,
  nextClear,
  progressLabel,
  progressMark,
  rowFullyCleared,
  rowNobodyRuns,
} from "@/lib/boss-clears";
import type { Boss, BossClearsByCharacter, BossSkipsByCharacter } from "@/types/boss";
import type { Character } from "@/types/character";

// Bosses on the ROWS, characters on the columns.
//
// The other way round does not fit: 16 bosses against a 794px column leaves ~47px per boss, which
// is not enough for a name and forces rotated headers. Characters are the smaller axis for almost
// everyone, and it is also how the same information is kept by hand today
// (test-fixtures/occluded/boss matrix.png), so the layout matches how it is already read.

// The planner itself groups by cadence (MONTHLY / WEEKLY / DAILY, see test-fixtures/occluded/boss
// planner.png), and the grouping is load-bearing here rather than decorative: two bosses in one
// matrix are not counting the same span of time, and a check under MONTHLY means something quite
// different from a check under WEEKLY. DAILY stays in the order though the tracker no longer keeps
// dailies: the list is filtered to the cadences actually present, so it costs nothing and is what
// this would need if they ever come back.
const CADENCE_ORDER = ["MONTHLY", "WEEKLY", "DAILY"];

// On a cold load neither the catalog nor the roster has arrived, so the loading state has nothing
// real to lay out. These stand in: the shape is right (one monthly and a run of weeklies, which is
// what the catalog actually looks like) even though the exact counts are not known client side
// until /api/bosses answers. Being a row or two out for one round-trip is a cosmetic difference;
// rendering an empty table is not.
const SKELETON_BOSSES: Boss[] = [
  { bossKey: "sk-monthly", name: "", reset: "MONTHLY", iconUrl: null, difficulties: [] },
  ...Array.from({ length: 8 }, (_, i) => ({
    bossKey: `sk-weekly-${i}`,
    name: "",
    reset: "WEEKLY",
    iconUrl: null,
    difficulties: [],
  })),
];

// Four characters on screen at once, and the rest are scrolled to. A roster of ten split a 730px
// column into 53px slices, which is narrower than the sprite that has to sit in one.
const VISIBLE_COLUMNS = 4;

const SKELETON_CHARACTERS = Array.from({ length: VISIBLE_COLUMNS }, (_, i) => ({
  id: `sk-char-${i}`,
  name: "",
  spriteImgUrl: null,
}));

export function BossMatrix({
  bosses,
  characters,
  clearsByCharacter,
  skipsByCharacter,
  loading,
  historyWeek,
  onToggle,
  busy,
}: {
  bosses: Boss[];
  characters: Pick<Character, "id" | "name" | "spriteImgUrl">[];
  clearsByCharacter: BossClearsByCharacter;
  /** Bosses each character does not run. Empty on a past week, which is not a period this answers for. */
  skipsByCharacter?: BossSkipsByCharacter;
  loading?: boolean;
  // Set when showing a past week rather than the current period. See the cadence filter below.
  historyWeek?: string | null;
  /**
   * Answers a cell by hand, without a planner capture. Omitted for a read-only matrix: a past week
   * is shown, not edited, the same rule Party View's cards follow.
   *
   * Two states, not three, matching the party toggle: a cell that has never been reported ticks to
   * cleared, and a cleared one un-ticks to not-cleared. There is no way back to "not reported" from
   * here, so the mark a click leaves is always an answer rather than a return to silence.
   */
  onToggle?: (characterId: string, bossKey: string, cleared: boolean) => void;
  /** A tick is in flight. Ticks serialise, so the matrix always draws what the server last said. */
  busy?: boolean;
}) {
  // Same table either way, so the loading and loaded layouts cannot drift apart.
  const rows = loading && bosses.length === 0 ? SKELETON_BOSSES : bosses;
  const columns = loading && characters.length === 0 ? SKELETON_CHARACTERS : characters;

  // The row band alone answers "which boss", but not "which character": the header sits up to 17
  // rows away, so reading a mark still means tracing a column by eye. CSS can do a row on its own
  // and cannot do a column, hence the state.
  const [hoveredColumn, setHoveredColumn] = useState<string | null>(null);
  const colClass = (characterId: string) => (hoveredColumn === characterId ? " is-col-hover" : "");

  // Indexed per character; see lib/boss-clears.ts for why the four cell states are four.
  const byCharacter = new Map<string, Map<string, boolean>>();
  for (const [characterId, clears] of Object.entries(clearsByCharacter)) {
    byCharacter.set(characterId, indexClears(clears));
  }
  const skipsBy = indexSkips(skipsByCharacter ?? {});

  // The period each cadence is currently in, taken from the data rather than recomputed. The reset
  // boundary lives in the backend (bosses/BossPeriod.kt); working it out again here would be a
  // second copy of the one number in this feature that must not be wrong.
  const periodByCadence = new Map<string, string>();
  for (const clears of Object.values(clearsByCharacter)) {
    for (const clear of clears) {
      const boss = bosses.find((b) => b.bossKey === clear.bossKey);
      if (boss && !periodByCadence.has(boss.reset))
        periodByCadence.set(boss.reset, clear.periodStart);
    }
  }

  // A past week can only answer for weekly bosses. Seven daily periods sit inside one week, so
  // there is no single "was Zakum cleared that week" to put in a cell, and a week can straddle two
  // months. Drawing one of several true answers as if it were the only one is the confident wrong
  // number this project exists to avoid, so the other two cadences are absent instead. The backend
  // returns weekly rows only for these views (see weeklyClearsFor); this keeps the empty MONTHLY
  // and DAILY bands off the table to match.
  const shown = historyWeek ? CADENCE_ORDER.filter((c) => c === "WEEKLY") : CADENCE_ORDER;
  const cadences = shown.filter((c) => rows.some((b) => b.reset === c));

  // How many screens wide the table is: 1 up to four characters, 2 at eight, and so on. The width
  // itself is the stylesheet's, which is the only place that knows how much of the column the boss
  // names take. This is the part it cannot know.
  const roster = Math.max(columns.length, 1);
  const span = roster / Math.min(roster, VISIBLE_COLUMNS);

  // Counted per cadence and never pooled across them, for the reason the bands exist at all: a
  // monthly and a weekly are not counting the same span of time, so one figure over both would be
  // a total of two different things.
  //
  // A past week brings no routine marks, so it gets a count with no denominator. See clearProgress.
  const routineKnown = !historyWeek;
  const statesOf = (characterId: string, list: Boss[]) =>
    list.map((boss) =>
      cellState(byCharacter.get(characterId), boss.bossKey, skipsBy.get(characterId)),
    );

  return (
    <div
      className="boss-matrix"
      style={{ "--boss-span": span, "--boss-cols": roster } as CSSProperties}
      role="status"
      aria-label={loading ? "Loading boss clears" : undefined}
      // Cleared here rather than per cell: leaving one cell for its neighbour would blank the band
      // between the two events.
      onMouseLeave={() => setHoveredColumn(null)}
    >
      <table className="boss-table">
        <thead>
          <tr>
            <th className="boss-col-head" scope="col">
              Boss
            </th>
            {columns.map((character) => (
              <th
                key={character.id}
                className={`boss-char-head${colClass(character.id)}`}
                scope="col"
                title={character.name}
                onMouseEnter={() => setHoveredColumn(character.id)}
              >
                {/* The slot is drawn whether or not there is a sprite, so a roster where only some
                    characters have one does not end up with ragged column heads. */}
                {loading ? (
                  <span className="skeleton sk-face" />
                ) : character.spriteImgUrl ? (
                  <img className="boss-char-sprite" src={character.spriteImgUrl} alt="" />
                ) : (
                  <span className="boss-char-sprite is-empty" aria-hidden="true" />
                )}
                {loading ? <span className="skeleton sk-line" /> : character.name}
              </th>
            ))}
          </tr>
        </thead>

        {cadences.map((cadence) => {
          const inCadence = rows.filter((boss) => boss.reset === cadence);
          // Summed over the roster, so the denominator is one per character per boss they run and
          // not the number of bosses. The week's work is a run, and a boss six characters run is
          // six of them.
          const rosterProgress = clearProgress(
            columns.flatMap((character) => statesOf(character.id, inCadence)),
            routineKnown,
          );
          return (
            <tbody key={cadence}>
              <tr className="boss-cadence-row">
                <th className="boss-cadence" scope="colgroup" colSpan={columns.length + 1}>
                  {/* Flexed on an inner span for the reason .boss-name-inner is: display:flex on a
                      cell takes it out of the table layout. */}
                  <span className="boss-cadence-inner">
                    <span>
                      {cadence}
                      {periodByCadence.has(cadence) && (
                        <span className="boss-period">
                          since {formatPeriod(periodByCadence.get(cadence)!)}
                        </span>
                      )}
                    </span>
                    {/* Withheld while loading rather than drawn at 0: the skeleton's rows are
                        invented (see SKELETON_BOSSES), so a figure over them would be a real-looking
                        count of nothing. */}
                    {!loading && (
                      <span className="boss-cadence-progress">
                        {/* Never the bar alone. It is a second reading of the number beside it, so
                            a proportion nobody can state (a past week) simply has no bar. */}
                        {rosterProgress.total ? (
                          <span className="boss-progress-bar" aria-hidden="true">
                            <span
                              style={{
                                width: `${(rosterProgress.cleared / rosterProgress.total) * 100}%`,
                              }}
                            />
                          </span>
                        ) : null}
                        {progressLabel(rosterProgress)}
                      </span>
                    )}
                  </span>
                </th>
              </tr>

              {inCadence.map((boss) => (
                <tr
                  key={boss.bossKey}
                  // Nothing left to do on this boss, so the row steps back. Two ways to get there
                  // and they are not the same fact: everyone who runs it is done, or nobody runs
                  // it at all. See rowFullyCleared for why an unreported character counts as
                  // neither.
                  className={
                    loading
                      ? undefined
                      : rowNobodyRuns(
                            columns.map((c) => c.id),
                            boss.bossKey,
                            skipsBy,
                          )
                        ? "is-row-unrun"
                        : rowFullyCleared(
                              byCharacter,
                              columns.map((c) => c.id),
                              boss.bossKey,
                              skipsBy,
                            )
                          ? "is-row-cleared"
                          : undefined
                  }
                >
                  <th className="boss-name" scope="row">
                    {/* Flexed on an inner span, not on the th: display:flex on a table cell takes
                        it out of the table layout and the column stops aligning. */}
                    <span className="boss-name-inner">
                      {/* The game's own portrait, cut from a planner capture, so a row is
                          recognisable before the name is read. The frame is drawn either way, so
                          the loading state and a boss with no art keep the column's width. */}
                      {!loading && boss.iconUrl ? (
                        <img className="boss-portrait" src={apiAssetUrl(boss.iconUrl)} alt="" />
                      ) : (
                        <span className="boss-portrait is-empty" aria-hidden="true" />
                      )}
                      {loading ? <span className="skeleton sk-line" /> : boss.name}
                    </span>
                  </th>
                  {columns.map((character) => {
                    if (loading) {
                      return (
                        <td
                          key={character.id}
                          className={`boss-cell${colClass(character.id)}`}
                          onMouseEnter={() => setHoveredColumn(character.id)}
                        >
                          <span className="skeleton sk-cell" />
                        </td>
                      );
                    }
                    const state = cellState(
                      byCharacter.get(character.id),
                      boss.bossKey,
                      skipsBy.get(character.id),
                    );
                    // Decorative; `said` is what a screen reader gets, and "not reported" is
                    // deliberately not "not cleared". Not-cleared is the empty one of the four:
                    // it is the only state you find by the gap it leaves, and the others have to
                    // be marks so that gap means something.
                    const mark =
                      state === "cleared"
                        ? "✓"
                        : state === "unseen"
                          ? "–"
                          : state === "skipped"
                            ? "·"
                            : "";
                    const said =
                      state === "cleared" || state === "pending"
                        ? `${boss.name} ${cellStateLabel(state)} by ${character.name}`
                        : `${boss.name}, ${character.name} ${cellStateLabel(state)}`;

                    // A boss this character does not run has no clear to tick, so the cell is a
                    // mark and not a control. Which bosses they run is answered on the routine
                    // page, where the whole set is visible at once.
                    const clickable = !!onToggle && state !== "skipped";
                    const title = state === "cleared" ? "Mark not cleared" : "Mark cleared";
                    return (
                      <td
                        key={character.id}
                        // is-editable moves the cell's padding onto the button, so the click
                        // target is the whole cell rather than the glyph in the middle of it.
                        className={`boss-cell is-${state}${clickable ? " is-editable" : ""}${colClass(character.id)}`}
                        onMouseEnter={() => setHoveredColumn(character.id)}
                      >
                        {clickable ? (
                          // The cell IS the control, rather than a mark with a control beside it:
                          // 16 bosses by a roster's worth of columns leaves no room for a second
                          // thing per cell, and the mark is already what you are aiming at.
                          <button
                            type="button"
                            className="boss-mark"
                            disabled={busy}
                            title={title}
                            onClick={() =>
                              onToggle!(character.id, boss.bossKey, nextClear(clearOfCell(state)))
                            }
                          >
                            <span aria-hidden="true">{mark}</span>
                            <span className="visually-hidden">{said}</span>
                          </button>
                        ) : (
                          <>
                            <span aria-hidden="true">{mark}</span>
                            <span className="visually-hidden">{said}</span>
                          </>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}

              {/* Under the columns rather than beside the names: the question it answers is "who
                  still has work", and that is read down a character, not across a boss. */}
              {!loading && (
                <tr className="boss-progress-row">
                  <th className="boss-name" scope="row">
                    Cleared
                  </th>
                  {columns.map((character) => {
                    const progress = clearProgress(statesOf(character.id, inCadence), routineKnown);
                    return (
                      <td
                        key={character.id}
                        className={`boss-progress-cell${colClass(character.id)}`}
                        onMouseEnter={() => setHoveredColumn(character.id)}
                      >
                        <span aria-hidden="true">{progressMark(progress)}</span>
                        {/* "8/12" is only an answer once you know whose column it is, and a
                            screen reader is not reading the column. */}
                        <span className="visually-hidden">
                          {character.name} {progressLabel(progress)}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              )}
            </tbody>
          );
        })}
      </table>

      {!loading && historyWeek && cadences.length === 0 && (
        <p className="boss-empty-week">No planner was captured this week.</p>
      )}

      {!loading && (
        <>
          <p className="boss-legend">
            {/* Swatches of the cell tints themselves, so the key is the thing rather than a
                description of it. */}
            <span className="boss-key is-cleared">✓</span> {cellStateLabel("cleared")}
            <span className="boss-key is-pending" /> {cellStateLabel("pending")}
            <span className="boss-key is-unseen">–</span> {cellStateLabel("unseen")}: no capture
            this period
            <span className="boss-key is-skipped">·</span> {cellStateLabel("skipped")}
          </p>
          {/* Said, not left as an absence: a reader who knows Zakum is in the catalog should not
              read its missing row as the week having lost it. Why only weekly is answerable is in
              weeklyClearsFor, not on screen. */}
          {historyWeek && <p className="boss-history-note">Weekly bosses only.</p>}
        </>
      )}
    </div>
  );
}
