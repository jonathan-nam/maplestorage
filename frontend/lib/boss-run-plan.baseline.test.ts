// The plans this search produces, frozen.
//
// boss-run-plan.test.ts states the RULES: count first, then party size, waiting, switches. This
// pins the ANSWERS, on forty pseudo-random nights, so that making the search faster cannot quietly
// make it decide differently. The rules leave ties, and a tie broken the other way is a different
// night for the party reading it.
//
// A change here is either a bug or a deliberate re-ranking. Re-record it only in a commit that says
// which, and never to make a red test green.

import { describe, expect, it } from "vitest";

import baseline from "./boss-run-plan.baseline.json";
import { type EligibleRun, type Plan, planNight, scheduleInOrder } from "./boss-run-plan";

/** Seeded, because a corpus that differs per run cannot pin anything. */
function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function caseFor(seed: number): { runs: EligibleRun[]; minutes: number } {
  const rand = mulberry32(seed);
  const pick = (n: number) => Math.floor(rand() * n);
  const people = 3 + pick(5);
  const count = 4 + pick(12);
  const runs: EligibleRun[] = [];
  for (let i = 0; i < count; i++) {
    const size = 2 + pick(4);
    const chosen = new Set<number>();
    while (chosen.size < Math.min(size, people)) chosen.add(pick(people));
    runs.push({
      id: `r${i}`,
      bossKey: `boss${pick(6)}`,
      bossName: `Boss ${i}`,
      difficulty: null,
      minutes: [15, 20, 30, 45][pick(4)] as number,
      seats: [...chosen].map((p) => ({ character: `p${p}c${pick(3)}`, personId: `p${p}` })),
    });
  }
  return { runs, minutes: [60, 90, 120, 180][pick(4)] as number };
}

/** Every field the page draws: the order, where each run lands, and who the marks are on. */
function describePlan(plan: Plan) {
  return {
    order: plan.runs
      .map((planned) => `${planned.run.id}@${planned.startsAt}[${planned.switched.join("+")}]`)
      .join(" "),
    switches: plan.switches,
    minutes: plan.minutes,
  };
}

// One test over all forty rather than it.each, which registers forty and reports each one's
// duration. Under a loaded machine that spuriously timed out a 13ms case twice in fifteen runs.
describe("planNight, against the recorded plans", () => {
  const seeds = Object.keys(baseline).map(Number);

  it("covers the whole corpus", () => {
    expect(seeds).toHaveLength(40);
  });

  it("plans every seed exactly as recorded", () => {
    const planned = seeds.map((seed) => {
      const { runs, minutes } = caseFor(seed);
      const { best, byCount } = planNight(runs, { minutes });
      return { seed, best: describePlan(best), byCount: byCount.map(describePlan) };
    });

    const recorded = seeds.map((seed) => ({
      seed,
      ...baseline[String(seed) as keyof typeof baseline],
    }));

    // One compare over the whole corpus, so a failure diffs every night that moved at once rather
    // than stopping at the first.
    expect(planned).toEqual(recorded);
  }, 60000);

  // The page draws every plan through scheduleInOrder, so that a night whose rows have been moved
  // and one straight out of the search are the same kind of thing. That only holds if the two agree
  // exactly: same times, same waits, same switch marks, on every night in the corpus. Where they
  // disagreed, a plan would change the moment it was drawn.
  it("re-derives its own plans from nothing but their order", () => {
    for (const seed of seeds) {
      const { runs, minutes } = caseFor(seed);
      const { best } = planNight(runs, { minutes });
      const again = scheduleInOrder(
        best.runs.map((planned) => planned.run),
        { minutes },
      );
      expect(again.plan).toEqual(best);
    }
  }, 60000);

  // The tie-break exists to make this true. Without it the beam keeps whichever equal-ranked state
  // it happened to reach first, and the same night comes out ordered differently.
  it("gives the same plan back for the same night, twice running", () => {
    for (const seed of seeds) {
      const first = caseFor(seed);
      const second = caseFor(seed);
      expect(describePlan(planNight(second.runs, { minutes: second.minutes }).best)).toEqual(
        describePlan(planNight(first.runs, { minutes: first.minutes }).best),
      );
    }
  }, 60000);
});
