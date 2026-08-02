// What the period still owes: a boss, and who has yet to run it.
//
// The matrix answers "where does everything stand", read as a grid. This answers "what is left",
// which is the one question the front page is there to answer. Both read cellState, so a boss
// cannot be outstanding here and ticked there.

import {
  CADENCE_ORDER,
  type CellState,
  cellState,
  type ClearProgress,
  clearProgress,
  indexClears,
  indexSkips,
} from "./boss-clears";
import type { Boss, BossClearsByCharacter, BossSkipsByCharacter } from "@/types/boss";
import type { Character } from "@/types/character";

/** All this needs of a character. Anything with a name and a face can be listed. */
export type Runner = Pick<Character, "id" | "name" | "spriteImgUrl">;

/** One boss still to run, and the characters who owe it. Never empty: see outstandingByCadence. */
export type OutstandingBoss = { boss: Boss; runners: Runner[] };

/**
 * One cadence's remaining work, with the progress it is part of.
 *
 * Counted per cadence and never pooled across them, for the reason the matrix's bands exist: a
 * monthly and a weekly are not counting the same span of time.
 */
export type OutstandingCadence = {
  cadence: string;
  progress: ClearProgress;
  bosses: OutstandingBoss[];
};

/**
 * Is this character's work on this boss still to do?
 *
 * `unseen` counts, and that is the load-bearing half. A boss nobody has captured is still one to
 * run until someone says otherwise, and dropping it would empty the list every Thursday, when no
 * capture has landed yet and every cell is unseen. "Nothing left to run" is the flattering
 * direction to be wrong in and the one this project refuses, so silence is listed as work. It can
 * only ever overstate what remains. Same asymmetry as clearProgress's denominator, which is why
 * the two agree: what is listed here is exactly total minus cleared.
 */
function stillToRun(state: CellState): boolean {
  return state === "pending" || state === "unseen";
}

/**
 * What is left to run this period, by cadence.
 *
 * The live view only. A past week carries no routine marks and cannot answer for a monthly or a
 * daily (see weeklyClearsFor), and "what is left" is not a question to ask of a week that ended.
 *
 * A cadence the catalog has no bosses for is dropped; a cadence with nothing outstanding is kept,
 * carrying its progress and an empty list. The two are different facts: one has no bosses in it,
 * the other has bosses and they are all done.
 */
export function outstandingByCadence(
  bosses: Boss[],
  characters: Runner[],
  clearsByCharacter: BossClearsByCharacter,
  skipsByCharacter: BossSkipsByCharacter,
): OutstandingCadence[] {
  const byCharacter = new Map(
    Object.entries(clearsByCharacter).map(([id, clears]) => [id, indexClears(clears)]),
  );
  const skipsBy = indexSkips(skipsByCharacter);

  return CADENCE_ORDER.filter((cadence) => bosses.some((boss) => boss.reset === cadence)).map(
    (cadence) => {
      const states: CellState[] = [];
      const outstanding: OutstandingBoss[] = [];

      for (const boss of bosses.filter((b) => b.reset === cadence)) {
        const runners: Runner[] = [];
        for (const character of characters) {
          const state = cellState(
            byCharacter.get(character.id),
            boss.bossKey,
            skipsBy.get(character.id),
          );
          states.push(state);
          if (stillToRun(state)) runners.push(character);
        }
        if (runners.length > 0) outstanding.push({ boss, runners });
      }

      // Always known: this is the live period, which is the only one with routine marks on it.
      return { cadence, progress: clearProgress(states, true), bosses: outstanding };
    },
  );
}
