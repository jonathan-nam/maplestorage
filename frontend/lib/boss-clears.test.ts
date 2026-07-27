import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  cellState,
  cellStateLabel,
  clearStateLabel,
  formatPeriod,
  formatWeekStart,
  indexClears,
  weekEndExclusive,
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

describe("clearStateLabel", () => {
  it("names the three states, and never calls silence a clear either way", () => {
    expect(clearStateLabel(true)).toBe("cleared");
    expect(clearStateLabel(false)).toBe("not cleared");
    expect(clearStateLabel(null)).toBe("not reported");
  });

  it("says the same words for the matrix's cell states", () => {
    expect(cellStateLabel("cleared")).toBe("cleared");
    expect(cellStateLabel("pending")).toBe("not cleared");
    expect(cellStateLabel("unseen")).toBe("not reported");
  });
});

// The party view once said "done" and "still to do" for the states the filter tabs above it called
// "Cleared" and "Not cleared". Nothing broke, so nothing caught it. The words are pinned here
// because they are the only thing that says which of three states a tick is in.
describe("the views name clear states through one place", () => {
  const source = (...parts: string[]) => readFileSync(join(__dirname, "..", ...parts), "utf8");
  const files = [
    ["components", "party-card.tsx"],
    ["components", "boss-matrix.tsx"],
    ["components", "planner-dock.tsx"],
    ["app", "bosses", "parties", "page.tsx"],
  ];

  for (const parts of files) {
    it(`${parts.at(-1)} labels states from boss-clears`, () => {
      const text = source(...parts);
      expect(text).toMatch(/\b(clearStateLabel|cellStateLabel)\(/);
      expect(text).not.toMatch(/still to do|not yet cleared/);
    });
  }
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

describe("weekEndExclusive", () => {
  it("steps to the next reset day", () => {
    expect(weekEndExclusive("2026-07-16")).toBe("2026-07-23");
    expect(weekEndExclusive("2026-07-23")).toBe("2026-07-30");
  });

  it("crosses a month, a year and a leap day without a calendar of its own", () => {
    expect(weekEndExclusive("2026-07-30")).toBe("2026-08-06");
    expect(weekEndExclusive("2026-12-31")).toBe("2027-01-07");
    expect(weekEndExclusive("2028-02-24")).toBe("2028-03-02");
  });

  it("stays on the day it was given rather than the viewer's", () => {
    // The pin for the UTC arithmetic: a local-time step lands a day out for anyone behind UTC, and
    // this label decides which configs a past week admits.
    const tz = process.env.TZ;
    process.env.TZ = "Pacific/Auckland";
    try {
      expect(weekEndExclusive("2026-07-16")).toBe("2026-07-23");
    } finally {
      process.env.TZ = tz;
    }
  });

  it("passes anything it cannot parse straight through rather than inventing a week", () => {
    expect(weekEndExclusive("not-a-date")).toBe("not-a-date");
    expect(weekEndExclusive("")).toBe("");
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
