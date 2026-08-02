import { describe, expect, it } from "vitest";
import { outstandingByCadence, type Runner } from "./boss-outstanding";
import type { Boss, BossClear } from "@/types/boss";

const boss = (bossKey: string, reset = "WEEKLY"): Boss => ({
  bossKey,
  name: bossKey,
  reset,
  iconUrl: null,
  difficulties: [],
});

const clear = (bossKey: string, cleared: boolean): BossClear => ({
  bossKey,
  cleared,
  periodStart: "2026-07-16",
  capturedAt: "2026-07-18T12:00:00Z",
});

const runner = (id: string): Runner => ({ id, name: id, spriteImgUrl: null });

const LOTUS = boss("lotus");
const DAMIEN = boss("damien");
const BLACK_MAGE = boss("black-mage", "MONTHLY");

const MAIN = runner("main");
const MULE = runner("mule");

describe("outstandingByCadence", () => {
  it("lists a boss nobody has said anything about", () => {
    // No capture has landed, so nothing is known. Listing it is the only answer that cannot
    // overstate how done the week is.
    const [weekly] = outstandingByCadence([LOTUS], [MAIN], {}, {});
    expect(weekly?.bosses).toEqual([{ boss: LOTUS, runners: [MAIN] }]);
  });

  it("drops a boss once every runner has cleared it", () => {
    const cadences = outstandingByCadence(
      [LOTUS, DAMIEN],
      [MAIN],
      { main: [clear("lotus", true)] },
      {},
    );
    expect(cadences[0]?.bosses.map((o) => o.boss.bossKey)).toEqual(["damien"]);
  });

  it("keeps the runners who still owe it and drops the ones who do not", () => {
    const [weekly] = outstandingByCadence(
      [LOTUS],
      [MAIN, MULE],
      { main: [clear("lotus", true)], mule: [clear("lotus", false)] },
      {},
    );
    expect(weekly?.bosses).toEqual([{ boss: LOTUS, runners: [MULE] }]);
  });

  it("does not ask a character for a boss they never run", () => {
    // The whole return on marking a routine. Without it a mule who runs one boss sits on the list
    // for the other fifteen forever.
    const [weekly] = outstandingByCadence([LOTUS], [MAIN, MULE], {}, { mule: ["lotus"] });
    expect(weekly?.bosses).toEqual([{ boss: LOTUS, runners: [MAIN] }]);
  });

  it("drops a boss nobody on the roster runs", () => {
    const [weekly] = outstandingByCadence([LOTUS], [MAIN], {}, { main: ["lotus"] });
    expect(weekly?.bosses).toEqual([]);
  });

  it("counts a clear that a character does not usually run", () => {
    // A one-off: skipped is not an answer about clearing, and a clear outranks it. Listing it as
    // still to run would ask for a boss that is already dead this week.
    const [weekly] = outstandingByCadence(
      [LOTUS],
      [MAIN],
      { main: [clear("lotus", true)] },
      { main: ["lotus"] },
    );
    expect(weekly?.bosses).toEqual([]);
    expect(weekly?.progress).toEqual({ cleared: 1, total: 1 });
  });

  it("keeps monthly and weekly apart, in the planner's order", () => {
    const cadences = outstandingByCadence([LOTUS, BLACK_MAGE], [MAIN], {}, {});
    expect(cadences.map((c) => c.cadence)).toEqual(["MONTHLY", "WEEKLY"]);
    expect(cadences[0]?.bosses.map((o) => o.boss.bossKey)).toEqual(["black-mage"]);
    expect(cadences[1]?.bosses.map((o) => o.boss.bossKey)).toEqual(["lotus"]);
  });

  it("leaves out a cadence the catalog has no bosses for", () => {
    expect(outstandingByCadence([LOTUS], [MAIN], {}, {}).map((c) => c.cadence)).toEqual(["WEEKLY"]);
  });

  it("keeps a cadence whose bosses are all done, with its progress", () => {
    // Not the same fact as a cadence with no bosses in it, and the band still has a count to
    // state. Dropping it would take "1/1 cleared" off the screen the moment it became true.
    const [monthly] = outstandingByCadence(
      [BLACK_MAGE],
      [MAIN],
      { main: [clear("black-mage", true)] },
      {},
    );
    expect(monthly?.bosses).toEqual([]);
    expect(monthly?.progress).toEqual({ cleared: 1, total: 1 });
  });

  it("counts one run per character per boss, not one per boss", () => {
    // The week's work is a run, and a boss six characters run is six of them.
    const [weekly] = outstandingByCadence([LOTUS, DAMIEN], [MAIN, MULE], {}, {});
    expect(weekly?.progress).toEqual({ cleared: 0, total: 4 });
  });

  it("lists exactly the runs the progress says are left", () => {
    // The invariant that keeps the list and the count from disagreeing: what is drawn IS
    // total minus cleared, so a band reading 3/8 has five chips under it.
    const [weekly] = outstandingByCadence(
      [LOTUS, DAMIEN],
      [MAIN, MULE],
      { main: [clear("lotus", true)], mule: [clear("damien", false)] },
      { mule: ["lotus"] },
    );
    const listed = weekly!.bosses.reduce((runs, o) => runs + o.runners.length, 0);
    expect(weekly?.progress).toEqual({ cleared: 1, total: 3 });
    expect(listed).toBe(2);
  });

  it("has nothing to say about an empty roster", () => {
    // Not "everything is done": a roster with nobody in it has nothing to run and nothing cleared.
    const [weekly] = outstandingByCadence([LOTUS], [], {}, {});
    expect(weekly?.bosses).toEqual([]);
    expect(weekly?.progress).toEqual({ cleared: 0, total: 0 });
  });
});
