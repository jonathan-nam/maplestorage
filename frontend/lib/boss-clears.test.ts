import { describe, expect, it } from "vitest";
import {
  cellState,
  formatPeriod,
  formatWeekStart,
  indexClears,
  weekLabel,
  rowFullyCleared,
} from "./boss-clears";
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

describe("rowFullyCleared", () => {
  // The matrix dims a row on this, and a dimmed row is read as "nothing left to do". Every case
  // below is one where saying true would hide a run somebody still has to make.
  const roster = ["ann", "bob", "cass"];
  const index = (entries: Record<string, BossClear[]>) =>
    new Map(Object.entries(entries).map(([id, clears]) => [id, indexClears(clears)]));

  it("is true only when every character has cleared it", () => {
    const byCharacter = index({
      ann: [clear("lotus", true)],
      bob: [clear("lotus", true)],
      cass: [clear("lotus", true)],
    });

    expect(rowFullyCleared(byCharacter, roster, "lotus")).toBe(true);
  });

  it("is false while one character has it reported and not done", () => {
    const byCharacter = index({
      ann: [clear("lotus", true)],
      bob: [clear("lotus", false)],
      cass: [clear("lotus", true)],
    });

    expect(rowFullyCleared(byCharacter, roster, "lotus")).toBe(false);
  });

  it("does not count silence as a clear", () => {
    // cass ran a planner capture that mentioned another boss, so there is no lotus row for her.
    // She has not said she cleared it, and the row must not claim she did.
    const byCharacter = index({
      ann: [clear("lotus", true)],
      bob: [clear("lotus", true)],
      cass: [clear("damien", true)],
    });

    expect(rowFullyCleared(byCharacter, roster, "lotus")).toBe(false);
  });

  it("does not count a character with no capture at all as a clear", () => {
    const byCharacter = index({ ann: [clear("lotus", true)], bob: [clear("lotus", true)] });

    expect(rowFullyCleared(byCharacter, roster, "lotus")).toBe(false);
  });

  it("is false for an empty roster rather than vacuously true", () => {
    // every() on nothing is true, which would dim every row on a page with no characters on it.
    expect(rowFullyCleared(new Map(), [], "lotus")).toBe(false);
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

describe("weekLabel", () => {
  it("names the week in progress on the live view", () => {
    // weekStart is null when nothing has been stepped to, and then the week being shown is the
    // one in progress. Party View only ever has this case.
    expect(weekLabel({ weekStart: null, currentWeekStart: "2026-07-23" })).toBe("Week of July 23");
  });

  it("names the week stepped to, not the one in progress", () => {
    expect(weekLabel({ weekStart: "2026-07-16", currentWeekStart: "2026-07-23" })).toBe(
      "Week of July 16",
    );
  });

  it("is one function so two pages cannot word the same week differently", () => {
    // The stepper on the Individual View and the standing label on Party View both read this.
    const view = { weekStart: null, currentWeekStart: "2026-01-01" };
    expect(weekLabel(view)).toBe(weekLabel({ ...view }));
    expect(weekLabel(view)).toBe("Week of January 1");
  });
});
