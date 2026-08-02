// How long a run is assumed to take when nobody has said.
//
// Thirty minutes, the same for every boss, and only a fallback. Nothing in this repo measures a
// run: a clear is stored as a boolean, so one boss key covers a Normal that dies in ninety seconds
// and a Hard that goes to the death counter. A per-boss table would be a column of invented
// numbers dressed as measurements, and the schedule built on it would be confidently wrong.
//
// A party that knows its own pace says so on its config, which is where the answer belongs: the
// same Hard Lucid is twenty minutes for one party and five for a stronger one, so the boss cannot
// answer for it. See V28__party_minutes.sql. This figure is what is left for the configs nobody
// has timed, and Run Order says on screen when it used it.
//
// It lives in the frontend rather than catalog/bosses.yaml because that manifest holds game facts,
// and "thirty minutes" is not one. Same reasoning that keeps the Auction House rates in
// drop-split.ts instead of a column.

/** What a run takes when its config has not been timed. */
export const DEFAULT_MINUTES = 30;

/** The longest a run may be said to take. Mirrors MAX_RUN_MINUTES in PartyQueries.kt. */
export const MAX_MINUTES = 600;

/**
 * The time in force for a config: what it says, or the fallback.
 *
 * Zero is honoured rather than treated as absent. `minutes || DEFAULT_MINUTES` would quietly
 * ignore it, and a boss a party walks through is a real thing to say.
 */
export function runMinutes(minutes: number | null | undefined): number {
  return minutes ?? DEFAULT_MINUTES;
}

/** A typed run time, or that it cannot be read as one. */
export type ParsedMinutes = { ok: true; minutes: number | null } | { ok: false };

/**
 * What was typed into a config's time box.
 *
 * Empty is null and means untimed, which is a real answer rather than a blank to be filled in.
 * Anything else has to be whole minutes in range: a "20 mins" read as 20, or a 3000 clamped to
 * 600, would be this app deciding what somebody meant. The caller refuses the save instead.
 */
export function parseMinutes(text: string): ParsedMinutes {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: true, minutes: null };
  if (!/^\d+$/.test(trimmed)) return { ok: false };
  const minutes = Number(trimmed);
  return minutes <= MAX_MINUTES ? { ok: true, minutes } : { ok: false };
}
