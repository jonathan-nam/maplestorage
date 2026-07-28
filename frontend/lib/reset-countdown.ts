// How long until a cadence rolls over, and how to say it.
//
// The instants themselves come from the backend (bosses/BossPeriod.kt), which is the only place
// that decides when a period ends. Nothing here recomputes a boundary; it subtracts and formats.

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * A live countdown, down to the second at every distance.
 *
 * Leading zero units are dropped so a five-hour wait does not read "0d". Seconds stay on even a
 * five-day countdown: it is the ticking that makes it a timer rather than a date, which is what
 * this is for.
 */
export function formatCountdown(ms: number): string {
  // Between the reset instant passing and the next poll landing, the honest answer is that it has
  // happened, not a negative duration.
  if (ms <= 0) return "now";

  const days = Math.floor(ms / DAY);
  const hours = Math.floor((ms % DAY) / HOUR);
  const minutes = Math.floor((ms % HOUR) / MINUTE);
  const seconds = Math.floor((ms % MINUTE) / SECOND);

  if (days > 0) return `${days}d ${hours}h ${minutes}m ${seconds}s`;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/**
 * The browser's clock, corrected to the server's.
 *
 * A machine whose clock is an hour out would otherwise show a countdown an hour wrong, right beside
 * a matrix filed against the server's idea of the week. The two disagreeing is the failure mode
 * this whole feature is careful about, so the timer reads the server's clock and ticks it forward
 * locally rather than reading the browser's.
 */
export function serverNowMs(serverNowIso: string, receivedAtMs: number, nowMs: number): number {
  const skew = Date.parse(serverNowIso) - receivedAtMs;
  return nowMs + skew;
}

/** Milliseconds until an ISO instant, on the server's clock. NaN-safe: an unparseable target is 0. */
export function msUntil(targetIso: string, serverNow: number): number {
  const target = Date.parse(targetIso);
  return Number.isNaN(target) ? 0 : target - serverNow;
}

/**
 * The soonest instant any cadence rolls over at, or null if none of them parse.
 *
 * Every cadence, not only the two the timer draws. Hiding the daily countdown is a display choice
 * (a nightly clock is not something you plan around), but a daily period rolling over makes the
 * screen just as stale as a weekly one, and a screen nobody told is the whole problem here.
 */
export function earliestReset(nextResets: Record<string, string>): string | null {
  let soonest: string | null = null;
  let soonestMs = Infinity;
  for (const at of Object.values(nextResets)) {
    const ms = Date.parse(at);
    if (Number.isNaN(ms) || ms >= soonestMs) continue;
    soonestMs = ms;
    soonest = at;
  }
  return soonest;
}

/** The cadence a page goes back to the current week for. See CrossedReset.cadences. */
export const WEEKLY_CADENCE = "WEEKLY";

/** A boundary that has passed, and which cadences turned over on it. */
export type CrossedReset = {
  /** The instant itself, which is what resetToAnnounce dedupes on. */
  at: string;
  /**
   * Every cadence rolling over at that instant, not just the soonest one.
   *
   * They coincide, and which ones did is the whole difference between the two things a page does
   * about it: Thursday 00:00 UTC is a weekly AND a daily boundary, so the week on screen ended; a
   * Tuesday midnight is daily alone and says nothing about the week you were reading.
   */
  cadences: string[];
};

/**
 * The boundary worth telling the page about, or null when there is nothing new to say.
 *
 * Reset writes nothing (see backend BossPeriod.kt), so a period rolls over with no request having
 * been made: an open tab keeps drawing last week until something refetches. This is what notices,
 * and the pages hang their refetch off it.
 *
 * Keyed on the instant rather than a boolean, so it fires ONCE per boundary instead of every tick
 * past it. That also decides what happens when the refetch fails: the served instant is unchanged,
 * so it is not announced twice and the page keeps its old data rather than retrying every second.
 * A stale screen is what a failed request already leaves; a request per second is worse.
 */
export function resetToAnnounce(
  nextResets: Record<string, string>,
  serverNow: number,
  announced: string | null,
): CrossedReset | null {
  const soonest = earliestReset(nextResets);
  if (soonest === null || soonest === announced) return null;
  if (msUntil(soonest, serverNow) > 0) return null;
  return {
    at: soonest,
    // Compared as instants, not as strings: two cadences landing on the same moment may well be
    // spelled differently, and a missed WEEKLY here is a week that quietly does not roll over.
    cadences: Object.entries(nextResets)
      .filter(([, at]) => Date.parse(at) === Date.parse(soonest))
      .map(([cadence]) => cadence),
  };
}
