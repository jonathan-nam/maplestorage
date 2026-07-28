import { describe, expect, it } from "vitest";
import {
  earliestReset,
  formatCountdown,
  msUntil,
  resetToAnnounce,
  serverNowMs,
} from "./reset-countdown";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("formatCountdown", () => {
  it("counts seconds at every distance, dropping only the leading zero units", () => {
    expect(formatCountdown(2 * DAY + 14 * HOUR + 32 * MINUTE + 9 * SECOND)).toBe("2d 14h 32m 9s");
    expect(formatCountdown(14 * HOUR + 32 * MINUTE + 9 * SECOND)).toBe("14h 32m 9s");
    expect(formatCountdown(32 * MINUTE + 9 * SECOND)).toBe("32m 9s");
    expect(formatCountdown(9 * SECOND)).toBe("9s");
  });

  it("says a reset that has passed has happened rather than showing negative time", () => {
    // The window between the instant passing and the next poll landing. "-3s to reset" would be
    // nonsense on screen, and a bare "0s" would look stuck.
    expect(formatCountdown(0)).toBe("now");
    expect(formatCountdown(-3 * SECOND)).toBe("now");
  });

  it("does not round a nearly-elapsed unit up into the next one", () => {
    // 1d 23h 59m is still one day away, not two. Rounding here would show a countdown that reads
    // longer than the time actually left.
    expect(formatCountdown(DAY + 23 * HOUR + 59 * MINUTE)).toBe("1d 23h 59m 0s");
    expect(formatCountdown(59 * MINUTE + 59 * SECOND)).toBe("59m 59s");
  });

  it("keeps the trailing zero units rather than dropping to one figure", () => {
    // A flat "7d" beside a "6d 23h 59m 59s" reads as a rounding, so the smaller units stay on at
    // zero. Only units above the largest non-zero one are dropped.
    expect(formatCountdown(7 * DAY)).toBe("7d 0h 0m 0s");
    expect(formatCountdown(HOUR)).toBe("1h 0m 0s");
  });
});

describe("serverNowMs", () => {
  it("counts down on the server's clock, not the browser's", () => {
    // A browser an hour behind. Without the correction the page would show an hour more than is
    // left, next to a matrix the server has already rolled over.
    const received = 1_000_000;
    const serverIso = new Date(received + HOUR).toISOString();
    expect(serverNowMs(serverIso, received, received)).toBe(received + HOUR);
    // And it keeps ticking from there.
    expect(serverNowMs(serverIso, received, received + 5 * SECOND)).toBe(
      received + HOUR + 5 * SECOND,
    );
  });

  it("is a no-op when the clocks agree", () => {
    const received = 1_000_000;
    const serverIso = new Date(received).toISOString();
    expect(serverNowMs(serverIso, received, received + SECOND)).toBe(received + SECOND);
  });
});

describe("msUntil", () => {
  it("measures to the target instant", () => {
    const now = Date.parse("2026-07-18T12:00:00Z");
    expect(msUntil("2026-07-23T00:00:00Z", now)).toBe(4 * DAY + 12 * HOUR);
  });

  it("treats an unparseable target as elapsed rather than NaN", () => {
    // NaN would render as "NaNd NaNh". Showing "now" is wrong too, but it is wrong in a way that
    // resolves on the next poll instead of persisting as garbage.
    expect(msUntil("not-a-date", Date.now())).toBe(0);
  });
});

const RESETS = {
  WEEKLY: "2026-07-30T00:00:00Z",
  DAILY: "2026-07-29T00:00:00Z",
  MONTHLY: "2026-08-01T00:00:00Z",
};

describe("earliestReset", () => {
  it("takes the soonest cadence, not the first or the one the timer leads with", () => {
    // DAILY is not drawn, and WEEKLY is listed first. Neither decides staleness.
    expect(earliestReset(RESETS)).toBe(RESETS.DAILY);
  });

  it("skips a cadence it cannot parse instead of letting it win as NaN", () => {
    expect(earliestReset({ DAILY: "not-a-date", WEEKLY: RESETS.WEEKLY })).toBe(RESETS.WEEKLY);
  });

  it("has nothing to say about an empty or wholly unparseable set", () => {
    expect(earliestReset({})).toBeNull();
    expect(earliestReset({ WEEKLY: "not-a-date" })).toBeNull();
  });
});

describe("resetToAnnounce", () => {
  const before = Date.parse("2026-07-28T23:59:59Z");
  const after = Date.parse("2026-07-29T00:00:01Z");

  it("says nothing while the soonest boundary is still ahead", () => {
    expect(resetToAnnounce(RESETS, before, null)).toBeNull();
  });

  it("announces the boundary once it has passed", () => {
    expect(resetToAnnounce(RESETS, after, null)).toBe(RESETS.DAILY);
  });

  it("announces the instant itself, with nothing left over", () => {
    // The tick that lands exactly on the boundary has already rolled over. Requiring it to be
    // strictly past would hold the refetch for a whole second on the one tick that is certain.
    expect(resetToAnnounce(RESETS, Date.parse(RESETS.DAILY), null)).toBe(RESETS.DAILY);
  });

  it("does not announce the same boundary twice", () => {
    // The timer keeps ticking past a boundary the server has not moved yet, which is exactly what
    // happens when the refetch fails. One stale screen beats a request every second.
    expect(resetToAnnounce(RESETS, after, RESETS.DAILY)).toBeNull();
    expect(resetToAnnounce(RESETS, after + 60_000, RESETS.DAILY)).toBeNull();
  });

  it("announces the next one after a refetch moves the boundary along", () => {
    // What the server answers once the daily period it was counting to has started.
    const moved = { ...RESETS, DAILY: "2026-07-30T00:00:00Z" };
    expect(resetToAnnounce(moved, Date.parse("2026-07-30T00:00:01Z"), RESETS.DAILY)).toBe(
      "2026-07-30T00:00:00Z",
    );
  });

  it("says nothing when no cadence was served", () => {
    expect(resetToAnnounce({}, after, null)).toBeNull();
  });
});
