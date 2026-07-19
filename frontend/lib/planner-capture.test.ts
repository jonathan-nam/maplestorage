import { describe, expect, it } from "vitest";
import { clearedCount, hasPlanner, plannerCaveats } from "./planner-capture";

describe("plannerCaveats", () => {
  it("flags a capture that stopped short of the bottom", () => {
    // The failure this guards: a truncated capture whose visible rows are all cleared reads
    // exactly like a fully cleared week.
    expect(plannerCaveats({ unreadableBossRows: 0, reachedBossListEnd: false })).toEqual([
      "truncated",
    ]);
  });

  it("flags rows the reader could not name", () => {
    expect(plannerCaveats({ unreadableBossRows: 2, reachedBossListEnd: true })).toEqual([
      "unreadable-rows",
    ]);
  });

  it("says nothing about a clean capture", () => {
    expect(plannerCaveats({ unreadableBossRows: 0, reachedBossListEnd: true })).toEqual([]);
  });

  it("does not call a capture with no planner truncated", () => {
    // null is "there was no list here", not "the list was cut short". An inventory-only capture
    // must not warn about a boss list it never contained.
    expect(plannerCaveats({ unreadableBossRows: null, reachedBossListEnd: null })).toEqual([]);
  });

  it("reports both when both are wrong", () => {
    expect(plannerCaveats({ unreadableBossRows: 3, reachedBossListEnd: false })).toEqual([
      "unreadable-rows",
      "truncated",
    ]);
  });
});

describe("hasPlanner", () => {
  const clear = (cleared: boolean) => ({ bossKey: "lotus", displayName: "Lotus", cleared });

  it("recognises a planner that read the list but found nothing cleared", () => {
    // Zero clears with reachedBossListEnd set is a real planner read, not an absent one, so the
    // dock must not treat it as "no planner in this capture".
    expect(hasPlanner({ bossClears: [], reachedBossListEnd: true })).toBe(true);
  });

  it("recognises an inventory-only capture", () => {
    expect(hasPlanner({ bossClears: [], reachedBossListEnd: null })).toBe(false);
  });

  it("recognises a planner from its clears alone", () => {
    expect(hasPlanner({ bossClears: [clear(true)], reachedBossListEnd: null })).toBe(true);
  });
});

describe("clearedCount", () => {
  it("counts only the cleared ones", () => {
    const clears = [
      { bossKey: "lotus", displayName: "Lotus", cleared: true },
      { bossKey: "damien", displayName: "Damien", cleared: false },
      { bossKey: "lucid", displayName: "Lucid", cleared: true },
    ];
    expect(clearedCount({ bossClears: clears })).toBe(2);
  });
});
