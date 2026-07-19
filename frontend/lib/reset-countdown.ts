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
