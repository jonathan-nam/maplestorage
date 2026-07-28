import type { BossClear, BossClearsView } from "@/types/boss";

// Four states, and the last two are both kinds of empty.
//
// A boss with no row has not been reported for this period: no capture has said anything about it.
// That is NOT "not cleared". Collapsing the two would turn a character whose planner was never
// captured into a character who cleared nothing, which is a confident wrong answer of exactly the
// kind this project exists to avoid.
//
// `skipped` splits that silence in two. "Nobody has said anything about Jupiter this week" and
// "this character never runs Jupiter" were one dash before, so a roster where one character runs a
// boss read as fifteen characters who were behind on it. Unlike the other three it carries no
// period: see V25__character_boss_skip.sql.
export type CellState = "cleared" | "pending" | "unseen" | "skipped";

/**
 * What a clear state is called, everywhere one is named out loud.
 *
 * One function because the wording had already split: the party grouping said "done" and "still to
 * do" for the states the filter tabs directly above it called "Cleared" and "Not cleared", so one
 * tick answered to two vocabularies on the same screen.
 */
export function clearStateLabel(cleared: boolean | null): string {
  if (cleared === null) return "not reported";
  return cleared ? "cleared" : "not cleared";
}

/**
 * A cell state as the boolean-or-null the rest of the app keeps a clear in.
 *
 * `skipped` is null, the same as never reported: it is not an answer about whether the boss died,
 * it is a statement that the question does not apply.
 */
export function clearOfCell(state: CellState): boolean | null {
  return state === "cleared" ? true : state === "pending" ? false : null;
}

/** The same names, for the matrix, which holds the four states as a CellState. */
export function cellStateLabel(state: CellState): string {
  if (state === "skipped") return "doesn't run";
  return clearStateLabel(clearOfCell(state));
}

/**
 * What a click on a clear in this state should write.
 *
 * One function for the matrix cell and the party card, so the two cannot end up disagreeing about
 * what un-ticking means. Two answers out of the three a clear has: "not reported" and "not cleared"
 * both tick to cleared, and cleared un-ticks to not-cleared. There is deliberately no way back to
 * "not reported" from a click, so a mark a click leaves is always an answer rather than a return to
 * silence. Only a capture, or a new period, puts a cell back to having said nothing.
 *
 * `skipped` never reaches here: it is not an answer about clearing, and the matrix does not offer
 * those cells as clear targets. Marking one is its own click, in routine mode.
 */
export function nextClear(cleared: boolean | null): boolean {
  return cleared !== true;
}

/** Index one character's clears for lookup. 16 bosses by N characters is a lot of find() scans. */
export function indexClears(clears: BossClear[] | undefined): Map<string, boolean> {
  return new Map((clears ?? []).map((c) => [c.bossKey, c.cleared]));
}

/**
 * Which of the four a cell is.
 *
 * A clear outranks "doesn't run", and that ordering is load-bearing rather than defensive. It is
 * how a one-off works: a character who does not normally run Jupiter but did this week shows the
 * tick, and is back to "doesn't run" next period with the routine never touched. Nothing rewrites
 * the routine on their behalf, which is what a clear silently dropping the mark would amount to.
 */
export function cellState(
  clears: Map<string, boolean> | undefined,
  bossKey: string,
  skips?: Set<string>,
): CellState {
  const cleared = clears?.get(bossKey);
  if (cleared) return "cleared";
  if (skips?.has(bossKey)) return "skipped";
  if (cleared === undefined) return "unseen";
  return "pending";
}

/**
 * Is this boss done for every character who runs it?
 *
 * The matrix dims a whole row on this answer, which is the row saying "nothing left to do here".
 * So `unseen` must not count: a character whose planner was not captured this period has not
 * answered, and treating silence as a clear is the same collapse `cellState` exists to prevent,
 * one step further along where it is harder to spot. An empty roster is not done either, it is a
 * roster with nothing to say.
 *
 * `skipped` is excluded rather than counted either way, and that is the whole gain from marking
 * one: a boss only your main runs now dims when your main clears it, instead of never dimming
 * because fifteen characters who never touch it are stuck on a dash. A row nobody runs is not
 * "done" here, it is `rowNobodyRuns`.
 */
export function rowFullyCleared(
  byCharacter: Map<string, Map<string, boolean>>,
  characterIds: string[],
  bossKey: string,
  skipsByCharacter?: Map<string, Set<string>>,
): boolean {
  const runners = characterIds.filter(
    (id) => cellState(byCharacter.get(id), bossKey, skipsByCharacter?.get(id)) !== "skipped",
  );
  if (runners.length === 0) return false;
  return runners.every((id) => cellState(byCharacter.get(id), bossKey) === "cleared");
}

/**
 * Does nobody on the roster run this boss?
 *
 * Its own answer rather than a `rowFullyCleared` that happens to be vacuously true. Both rows step
 * back, but "everyone who runs it is done" and "nobody runs it" are different facts, and the second
 * one dimmed as the first would read as a week's work that was never done getting ticked off.
 */
export function rowNobodyRuns(
  characterIds: string[],
  bossKey: string,
  skipsByCharacter?: Map<string, Set<string>>,
): boolean {
  if (characterIds.length === 0) return false;
  return characterIds.every((id) => skipsByCharacter?.get(id)?.has(bossKey) ?? false);
}

/** One character's skipped boss keys, for lookup, the way indexClears does for clears. */
export function indexSkips(skips: Record<string, string[]>): Map<string, Set<string>> {
  return new Map(Object.entries(skips).map(([characterId, keys]) => [characterId, new Set(keys)]));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "2026-07-16" -> "16 Jul".
 *
 * Parsed by hand rather than through Date on purpose: `new Date("2026-07-16")` is UTC midnight,
 * which renders as the 15th for every viewer behind UTC. The whole job of this label is to say
 * which period you are looking at, so being a day out defeats it.
 */
export function formatPeriod(iso: string): string {
  const [, month, day] = iso.split("-").map(Number);
  if (!month || !day || month < 1 || month > MONTHS.length) return iso;
  return `${day} ${MONTHS[month - 1]}`;
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * "2026-07-16" -> "July 16", the day the week reset.
 *
 * The date is UTC (midnight Thursday, see BossPeriod.kt) and is shown unconverted, so a viewer
 * behind UTC reads the week's real start rather than their own local one. Hand-parsed for the same
 * reason as formatPeriod.
 */
export function formatWeekStart(iso: string): string {
  const [, month, day] = iso.split("-").map(Number);
  if (!month || !day || month < 1 || month > MONTH_NAMES.length) return iso;
  return `${MONTH_NAMES[month - 1]} ${day}`;
}

/**
 * The reset day that ends a week, exclusive: "2026-07-16" -> "2026-07-23".
 *
 * Stepped in UTC. The boundary is midnight Thursday UTC (see BossPeriod.kt), so walking it through
 * local time would land a day out for every viewer who is not on it, which is the same trap
 * formatPeriod avoids.
 */
export function weekEndExclusive(weekStart: string): string {
  const [year, month, day] = weekStart.split("-").map(Number);
  if (!year || !month || !day) return weekStart;
  return new Date(Date.UTC(year, month - 1, day + 7)).toISOString().slice(0, 10);
}

/**
 * Which week a view is showing: "Week of July 16".
 *
 * Shared by the stepper on the Individual View and the standing label on Party View, so the two
 * cannot end up wording the same week differently. `weekStart` is null on the live view, and then
 * the week in progress is the one being shown.
 */
export function weekLabel(view: Pick<BossClearsView, "weekStart" | "currentWeekStart">): string {
  return `Week of ${formatWeekStart(view.weekStart ?? view.currentWeekStart)}`;
}
