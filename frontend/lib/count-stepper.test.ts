import { describe, expect, it } from "vitest";
import { MAX_COUNT, SAVE_AFTER_MS, clampCount, stepFor } from "./count-stepper";

describe("how a held button speeds up", () => {
  it("gives a plain click one, and a long pause before anything repeats", () => {
    // A click that turned into two would be worse than no acceleration at all.
    const first = stepFor(0);
    expect(first.step).toBe(1);
    expect(first.wait).toBeGreaterThanOrEqual(400);
  });

  it("shortens the wait before it grows the step", () => {
    // Staggered on purpose. A short hold still moves one at a time and lands exactly where you
    // meant; a number that starts jumping five at a time immediately is one you cannot land on 7.
    const early = stepFor(500);
    const quick = stepFor(1500);

    expect(early.step).toBe(1);
    expect(quick.step).toBe(1);
    expect(quick.wait).toBeLessThan(early.wait);
  });

  it("grows the step only once somebody is plainly holding on purpose", () => {
    expect(stepFor(3500).step).toBeGreaterThan(1);
    expect(stepFor(7000).step).toBeGreaterThan(stepFor(3500).step);
  });

  it("never goes backwards as the hold gets longer", () => {
    // Monotonic in both: a hold that sped up and then slowed down would be unusable, and one whose
    // step shrank would make the number stutter.
    let lastStep = 0;
    let lastWait = Infinity;
    for (let held = 0; held <= 10_000; held += 50) {
      const { step, wait } = stepFor(held);
      expect(step).toBeGreaterThanOrEqual(lastStep);
      expect(wait).toBeLessThanOrEqual(lastWait);
      lastStep = step;
      lastWait = wait;
    }
  });

  it("answers for a hold longer than anything in the table", () => {
    expect(stepFor(60_000).step).toBeGreaterThan(0);
    expect(stepFor(60_000).wait).toBeGreaterThan(0);
  });
});

describe("keeping a count inside what anybody can hold", () => {
  it("stops at nothing rather than running negative", () => {
    // Holding minus on an empty slot has to stop, not run to -40 and refuse to save at the end.
    expect(clampCount(-1)).toBe(0);
    expect(clampCount(0 - 25)).toBe(0);
  });

  it("stops at the ceiling the server would refuse", () => {
    expect(clampCount(MAX_COUNT + 1)).toBe(MAX_COUNT);
    expect(clampCount(MAX_COUNT)).toBe(MAX_COUNT);
  });

  it("leaves an ordinary count alone", () => {
    expect(clampCount(14)).toBe(14);
    expect(clampCount(0)).toBe(0);
  });

  it("never yields something that is not a count", () => {
    expect(clampCount(Number.NaN)).toBe(0);
    expect(clampCount(Number.POSITIVE_INFINITY)).toBe(MAX_COUNT);
    expect(clampCount(2.6)).toBe(3);
  });
});

describe("when the total gets written", () => {
  it("waits long enough that a hold is one write, not forty", () => {
    expect(SAVE_AFTER_MS).toBeGreaterThanOrEqual(300);
    // And short enough that letting go feels like it saved.
    expect(SAVE_AFTER_MS).toBeLessThanOrEqual(1500);
  });
});
