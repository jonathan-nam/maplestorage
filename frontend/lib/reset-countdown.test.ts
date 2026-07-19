import { describe, expect, it } from "vitest";
import { formatCountdown, msUntil, serverNowMs } from "./reset-countdown";

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
