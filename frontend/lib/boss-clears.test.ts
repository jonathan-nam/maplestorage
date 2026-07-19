import { describe, expect, it } from "vitest";
import { cellState, formatPeriod, formatWeekStart, indexClears } from "./boss-clears";
import type { BossClear } from "@/types/boss";

const clear = (bossKey: string, cleared: boolean): BossClear => ({
  bossKey,
  cleared,
  periodStart: "2026-07-16",
  capturedAt: "2026-07-18T12:00:00Z",
});

describe("cellState", () => {
  it("separates a boss that was not cleared from one nothing was said about", () => {
    // The distinction the whole matrix rests on. A planner capture reports every boss the
    // character runs, so cleared=false is real information: it was seen, and it is not done.
    // A boss with no row at all was never reported, and calling that "not cleared" invents an
    // answer for a character whose planner may simply never have been captured.
    const clears = indexClears([clear("lotus", true), clear("damien", false)]);

    expect(cellState(clears, "lotus")).toBe("cleared");
    expect(cellState(clears, "damien")).toBe("pending");
    expect(cellState(clears, "lucid")).toBe("unseen");
  });

  it("treats a character with no clears at all as unseen, not as cleared nothing", () => {
    expect(cellState(indexClears(undefined), "lotus")).toBe("unseen");
    expect(cellState(indexClears([]), "lotus")).toBe("unseen");
    expect(cellState(undefined, "lotus")).toBe("unseen");
  });
});

describe("formatPeriod", () => {
  it("reads the date as written rather than through a timezone", () => {
    // new Date("2026-07-16") is UTC midnight, so anyone behind UTC would see "15 Jul" for a
    // period that starts on the 16th. The label exists to say which period this is.
    expect(formatPeriod("2026-07-16")).toBe("16 Jul");
    expect(formatPeriod("2026-01-01")).toBe("1 Jan");
    expect(formatPeriod("2026-12-31")).toBe("31 Dec");
  });

  it("passes anything it cannot parse straight through rather than inventing a date", () => {
    expect(formatPeriod("")).toBe("");
    expect(formatPeriod("not-a-date")).toBe("not-a-date");
    expect(formatPeriod("2026-13-01")).toBe("2026-13-01");
  });
});

describe("formatWeekStart", () => {
  it("reads the date as written rather than through a timezone", () => {
    expect(formatWeekStart("2026-07-16")).toBe("July 16");
    expect(formatWeekStart("2026-01-01")).toBe("January 1");
    expect(formatWeekStart("2026-12-31")).toBe("December 31");
  });

  it("passes anything it cannot parse straight through rather than inventing a date", () => {
    expect(formatWeekStart("not-a-date")).toBe("not-a-date");
    expect(formatWeekStart("")).toBe("");
    expect(formatWeekStart("2026-13-01")).toBe("2026-13-01");
  });
});
