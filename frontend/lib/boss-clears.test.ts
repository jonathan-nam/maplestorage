import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  cellState,
  cellStateLabel,
  clearOfCell,
  clearProgress,
  clearStateLabel,
  formatPeriod,
  formatWeekStart,
  indexClears,
  indexSkips,
  nextClear,
  progressLabel,
  progressMark,
  weekEndExclusive,
  weekLabel,
  rowFullyCleared,
  rowNobodyRuns,
} from "./boss-clears";
import type { BossClear } from "@/types/boss";

const clear = (bossKey: string, cleared: boolean): BossClear => ({
  bossKey,
  cleared,
  periodStart: "2026-07-16",
  capturedAt: "2026-07-18T12:00:00Z",
});

describe("nextClear", () => {
  it("ticks an unreported cell to cleared rather than to not-cleared", () => {
    // The first click on a cell nothing has been said about is somebody saying they killed it.
    // Writing "not cleared" instead would put a claim on screen that nobody made.
    expect(nextClear(null)).toBe(true);
  });

  it("ticks and un-ticks between the two answers", () => {
    expect(nextClear(false)).toBe(true);
    expect(nextClear(true)).toBe(false);
  });

  it("never writes its way back to unreported", () => {
    // Two answers out of three states, on purpose: a click always leaves an answer. Only a capture
    // or a new period puts a cell back to having said nothing. The matrix and the party card share
    // this function so they cannot drift on it.
    for (const from of [null, false, true]) {
      expect(typeof nextClear(from)).toBe("boolean");
    }
  });
});

describe("clearOfCell", () => {
  it("keeps unseen apart from not-cleared when a cell state becomes a clear", () => {
    expect(clearOfCell("unseen")).toBeNull();
    expect(clearOfCell("pending")).toBe(false);
    expect(clearOfCell("cleared")).toBe(true);
  });
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

  it("separates a boss nobody has answered for from one this character never runs", () => {
    // The reason the fourth state exists. Both are a missing clear row, and before the mark they
    // drew the same dash, so a boss only one character runs read as a roster that was behind on it.
    const clears = indexClears([clear("lotus", true)]);
    const skips = new Set(["jupiter"]);

    expect(cellState(clears, "jupiter", skips)).toBe("skipped");
    expect(cellState(clears, "lucid", skips)).toBe("unseen");
  });

  it("lets a clear outrank the mark, which is how a one-off run shows up", () => {
    // A character who does not normally run Jupiter but did this week. The tick shows, and the
    // routine is untouched, so next period the cell is back to "doesn't run". Nothing rewrites
    // what the user said about the character on the strength of one week.
    const clears = indexClears([clear("jupiter", true)]);

    expect(cellState(clears, "jupiter", new Set(["jupiter"]))).toBe("cleared");
  });

  it("keeps the mark over a pending row, since a planner listing a boss is not a claim to run it", () => {
    const clears = indexClears([clear("jupiter", false)]);

    expect(cellState(clears, "jupiter", new Set(["jupiter"]))).toBe("skipped");
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
    expect(cellStateLabel("skipped")).toBe("doesn't run");
  });

  it("does not turn a boss nobody runs into an answer about clearing it", () => {
    // "doesn't run" is not a third answer to "was it cleared", it is the question not applying.
    // Calling it not-cleared is what put fifteen characters behind on Jupiter.
    expect(clearOfCell("skipped")).toBeNull();
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

  it("ignores the characters who do not run it, which is the point of saying so", () => {
    // Only ann runs Jupiter. Before the mark this row could never dim, because bob and cass sat on
    // a dash forever, so the one row with real work left looked like the fifteen without any.
    const byCharacter = index({ ann: [clear("jupiter", true)] });
    const skips = indexSkips({ bob: ["jupiter"], cass: ["jupiter"] });

    expect(rowFullyCleared(byCharacter, roster, "jupiter", skips)).toBe(true);
  });

  it("still counts a runner who has said nothing", () => {
    // cass does not run it, but bob does and has not answered. Dimming here would hide bob's run.
    const byCharacter = index({ ann: [clear("jupiter", true)] });
    const skips = indexSkips({ cass: ["jupiter"] });

    expect(rowFullyCleared(byCharacter, roster, "jupiter", skips)).toBe(false);
  });

  it("is false when nobody runs it, rather than calling an untouched boss done", () => {
    // Vacuously true otherwise. "Everyone who runs it is done" and "nobody runs it" both quieten
    // the row, but they are different facts and only one of them is a week's work being finished.
    const skips = indexSkips({ ann: ["jupiter"], bob: ["jupiter"], cass: ["jupiter"] });

    expect(rowFullyCleared(new Map(), roster, "jupiter", skips)).toBe(false);
    expect(rowNobodyRuns(roster, "jupiter", skips)).toBe(true);
  });
});

describe("rowNobodyRuns", () => {
  const roster = ["ann", "bob", "cass"];

  it("is false while one character still runs it", () => {
    expect(rowNobodyRuns(roster, "jupiter", indexSkips({ bob: ["jupiter"] }))).toBe(false);
  });

  it("is false for an empty roster, like rowFullyCleared", () => {
    expect(rowNobodyRuns([], "jupiter", indexSkips({}))).toBe(false);
  });

  it("is false when nothing has been marked at all", () => {
    // The default state of every account. Nobody having said anything is not everybody opting out.
    expect(rowNobodyRuns(roster, "jupiter", undefined)).toBe(false);
  });
});

describe("clearProgress", () => {
  it("counts the clears against the bosses that are run", () => {
    expect(clearProgress(["cleared", "cleared", "pending", "skipped"], true)).toEqual({
      cleared: 2,
      total: 3,
    });
  });

  it("counts a boss nobody has captured as one still to run", () => {
    // The trap this whole function exists around. Every period starts with every cell unseen, so
    // dropping them from the denominator would open each Thursday at 0/0, and 0/0 is a week with
    // nothing left in it. Overstating the work is the only safe direction to be wrong.
    expect(clearProgress(["unseen", "unseen", "unseen"], true)).toEqual({ cleared: 0, total: 3 });
  });

  it("keeps a routine off the denominator, which is the return on marking one", () => {
    const runsFour = clearProgress(
      ["cleared", "cleared", "cleared", "cleared", "skipped", "skipped"],
      true,
    );
    expect(runsFour).toEqual({ cleared: 4, total: 4 });
    expect(progressMark(runsFour)).toBe("4/4");
  });

  it("gives no denominator when the routine is not known, rather than counting every boss", () => {
    // A past week is served without routine marks, so the same states arrive with nothing marked
    // skipped. Reaching a denominator by that accident would state a past week's target as
    // confidently as a live one, and it would be the wrong number.
    expect(clearProgress(["cleared", "pending", "unseen"], false)).toEqual({
      cleared: 1,
      total: null,
    });
  });

  it("is empty, not complete, for a character who runs nothing in the band", () => {
    const runsNothing = clearProgress(["skipped", "skipped"], true);
    expect(runsNothing).toEqual({ cleared: 0, total: 0 });
    // 0/0 is a met target. This is the absence of one, and it says so in the matrix's own word.
    expect(progressMark(runsNothing)).toBe("·");
    expect(progressLabel(runsNothing)).toBe("none to run");
  });

  it("counts nothing at all as nothing to run", () => {
    expect(clearProgress([], true)).toEqual({ cleared: 0, total: 0 });
  });
});

describe("progressLabel", () => {
  it("says what the number is, since a heading has room for the word", () => {
    expect(progressLabel({ cleared: 8, total: 12 })).toBe("8/12 cleared");
  });

  it("drops the denominator without dropping the count", () => {
    expect(progressLabel({ cleared: 12, total: null })).toBe("12 cleared");
    expect(progressMark({ cleared: 12, total: null })).toBe("12");
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
