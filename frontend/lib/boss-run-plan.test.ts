import { describe, expect, it } from "vitest";

import {
  type CandidateRun,
  type EligibleRun,
  type Plan,
  planNight,
  screenRuns,
  tradeOffs,
} from "./boss-run-plan";

function run(
  id: string,
  bossKey: string,
  minutes: number,
  seats: [string, string | null][],
): CandidateRun {
  return {
    id,
    bossKey,
    bossName: bossKey,
    minutes,
    seats: seats.map(([character, personId]) => ({ character, personId })),
  };
}

function eligible(
  id: string,
  bossKey: string,
  minutes: number,
  seats: [string, string][],
): EligibleRun {
  return {
    id,
    bossKey,
    bossName: bossKey,
    minutes,
    seats: seats.map(([character, personId]) => ({ character, personId })),
  };
}

const order = (plan: { runs: { run: { id: string } }[] }) => plan.runs.map((r) => r.run.id);

/** How many unbroken same-character stretches a sequence falls into. */
const blocks = (characters: string[]) =>
  characters.filter((character, i) => character !== characters[i - 1]).length;

describe("screenRuns", () => {
  it("keeps a run whose every seat is somebody who turned up", () => {
    const { eligible: kept, rejected } = screenRuns(
      [
        run("a", "lotus", 10, [
          ["Mechy", "me"],
          ["Creed", "chris"],
        ]),
      ],
      ["me", "chris"],
    );
    expect(kept.map((r) => r.id)).toEqual(["a"]);
    expect(rejected).toEqual([]);
  });

  it("refuses a party holding two characters of the same person", () => {
    const { eligible: kept, rejected } = screenRuns(
      [
        run("a", "lotus", 10, [
          ["Mechy", "me"],
          ["Creed", "chris"],
          ["Dwight", "chris"],
        ]),
      ],
      ["me", "chris"],
    );
    expect(kept).toEqual([]);
    expect(rejected[0]?.reason).toBe("person-twice");
    // Names both of the seats, so the UI can say which pair collided.
    expect(rejected[0]?.detail).toEqual(["Creed", "Dwight"]);
  });

  it("refuses a party holding two of YOUR characters, which is the same collision", () => {
    const { rejected } = screenRuns(
      [
        run("a", "lotus", 10, [
          ["Mechy", "me"],
          ["Otherme", "me"],
        ]),
      ],
      ["me"],
    );
    expect(rejected[0]?.reason).toBe("person-twice");
  });

  it("drops a run whose seat belongs to somebody who is not on", () => {
    const { eligible: kept, rejected } = screenRuns(
      [
        run("a", "lotus", 10, [
          ["Mechy", "me"],
          ["Creed", "chris"],
        ]),
      ],
      ["me"],
    );
    expect(kept).toEqual([]);
    expect(rejected[0]?.reason).toBe("person-unavailable");
    expect(rejected[0]?.detail).toEqual(["chris"]);
  });

  it("will not schedule a seat nobody has been attributed to", () => {
    const { eligible: kept, rejected } = screenRuns(
      [
        run("a", "lotus", 10, [
          ["Mechy", "me"],
          ["Stranger", null],
        ]),
      ],
      ["me"],
    );
    expect(kept).toEqual([]);
    expect(rejected[0]?.reason).toBe("unattributed-seat");
    expect(rejected[0]?.detail).toEqual(["Stranger"]);
  });

  it("reports the double-booking ahead of the absence, because it is broken either way", () => {
    const { rejected } = screenRuns(
      [
        run("a", "lotus", 10, [
          ["Creed", "chris"],
          ["Dwight", "chris"],
        ]),
      ],
      [],
    );
    expect(rejected[0]?.reason).toBe("person-twice");
  });
});

describe("planNight", () => {
  it("returns an empty plan when nothing fits", () => {
    const { best, byCount } = planNight([eligible("a", "lotus", 40, [["Mechy", "me"]])], {
      minutes: 30,
    });
    expect(best.runs).toEqual([]);
    expect(byCount).toEqual([]);
  });

  it("keeps one person on one character by putting that character's runs together", () => {
    // Alternating Mechy/Kanna/Mechy/Kanna would cost three switches. Grouping costs one.
    const runs = [
      eligible("lotus", "lotus", 10, [["Mechy", "me"]]),
      eligible("damien", "damien", 10, [["Kanna", "me"]]),
      eligible("lucid", "lucid", 10, [["Mechy", "me"]]),
      eligible("will", "will", 10, [["Kanna", "me"]]),
    ];
    const { best } = planNight(runs, { minutes: 120 });

    expect(best.runs).toHaveLength(4);
    expect(best.switches).toBe(1);
    // Which character goes first is a coin flip between two equally good plans, so the assertion
    // is on the shape: each character's runs are one unbroken block.
    const characters = best.runs.map((r) => r.run.seats[0]?.character ?? "");
    expect(blocks(characters)).toEqual(new Set(characters).size);
  });

  it("counts a switch per person, not per run", () => {
    const runs = [
      eligible("a", "lotus", 10, [
        ["Mechy", "me"],
        ["Creed", "chris"],
      ]),
      eligible("b", "damien", 10, [
        ["Kanna", "me"],
        ["Dwight", "chris"],
      ]),
    ];
    const { best } = planNight(runs, { minutes: 120 });
    expect(best.switches).toBe(2);
    expect(best.runs[1]?.switched.sort()).toEqual(["chris", "me"]);
  });

  it("bills the budget for runs and nothing else", () => {
    // A switch between them, and the two runs still add up to exactly 20. The window is spent on
    // bosses, so a night of 30-minute runs fills a 2 hour window with four of them and not three.
    const runs = [
      eligible("a", "lotus", 10, [["Mechy", "me"]]),
      eligible("b", "damien", 10, [["Kanna", "me"]]),
    ];
    const { best } = planNight(runs, { minutes: 20 });
    expect(best.runs).toHaveLength(2);
    expect(best.switches).toBe(1);
    expect(best.minutes).toBe(20);
  });

  it("does not make somebody log in twice for a run they sit out", () => {
    // Chris is only in run b, which goes first for being the biggest. Sitting out the other two
    // does not park him anywhere new, so the whole night costs ME one switch and CHRIS none.
    const runs = [
      eligible("a", "lotus", 10, [["Mechy", "me"]]),
      eligible("b", "damien", 10, [
        ["Kanna", "me"],
        ["Creed", "chris"],
      ]),
      eligible("c", "lucid", 10, [["Mechy", "me"]]),
    ];
    const { best } = planNight(runs, { minutes: 120 });
    expect(best.runs).toHaveLength(3);
    expect(best.switches).toBe(1);
    expect(order(best)).toEqual(["b", "a", "c"]);
  });

  it("runs the fullest parties first", () => {
    const runs = [
      eligible("solo", "lotus", 10, [["Mechy", "me"]]),
      eligible("trio", "damien", 10, [
        ["Mechy", "me"],
        ["Creed", "chris"],
        ["Dwight", "dave"],
      ]),
      eligible("duo", "lucid", 10, [
        ["Mechy", "me"],
        ["Creed", "chris"],
      ]),
    ];
    const { best } = planNight(runs, { minutes: 120 });
    expect(order(best)).toEqual(["trio", "duo", "solo"]);
  });

  it("keeps somebody's handful of runs together instead of spread across the night", () => {
    // Chris and Dave are in two runs each, and me in all four on one character. Alternating them
    // costs nobody a switch and still leaves both sitting out a boss in the middle of their night.
    const runs = [
      eligible("a", "lotus", 10, [
        ["Mechy", "me"],
        ["Creed", "chris"],
      ]),
      eligible("b", "damien", 10, [
        ["Mechy", "me"],
        ["Dwight", "dave"],
      ]),
      eligible("c", "lucid", 10, [
        ["Mechy", "me"],
        ["Creed", "chris"],
      ]),
      eligible("d", "will", 10, [
        ["Mechy", "me"],
        ["Dwight", "dave"],
      ]),
    ];
    const { best } = planNight(runs, { minutes: 120 });

    expect(best.switches).toBe(0);
    const partners = best.runs.map((r) => r.run.seats[1]?.personId ?? "");
    expect(blocks(partners)).toBe(2);
  });

  it("does not strand somebody in the middle to save a switch", () => {
    // My two characters split chris and dave down the middle. Running a, b, c, d parks me on
    // Mechy then Kanna for one switch all night, and leaves BOTH of them sitting out a boss
    // between their two. Pairing each of them up instead costs a second switch and no waiting.
    const runs = [
      eligible("a", "lotus", 10, [
        ["Mechy", "me"],
        ["Creed", "chris"],
      ]),
      eligible("b", "damien", 10, [
        ["Mechy", "me"],
        ["Dwight", "dave"],
      ]),
      eligible("c", "lucid", 10, [
        ["Kanna", "me"],
        ["Creed", "chris"],
      ]),
      eligible("d", "will", 10, [
        ["Kanna", "me"],
        ["Dwight", "dave"],
      ]),
    ];
    const { best } = planNight(runs, { minutes: 120 });

    const partners = best.runs.map((r) => r.run.seats[1]?.personId ?? "");
    expect(blocks(partners)).toBe(2);
    expect(best.switches).toBe(2);
  });

  it("puts a fuller party first even when that costs a switch", () => {
    // Kanna's two runs would group for free, but that leaves the three-person boss until last,
    // by which time somebody has gone to bed. One relog is the cheaper thing to spend.
    const runs = [
      eligible("a", "lotus", 10, [["Kanna", "me"]]),
      eligible("b", "damien", 10, [["Kanna", "me"]]),
      eligible("c", "lucid", 10, [
        ["Mechy", "me"],
        ["Creed", "chris"],
        ["Dwight", "dave"],
      ]),
    ];
    const { best } = planNight(runs, { minutes: 120 });
    expect(order(best)).toEqual(["c", "a", "b"]);
    expect(best.switches).toBe(1);
  });

  it("never books one character onto the same boss twice", () => {
    // Two configs for Lotus that share Mechy. Mechy clears Lotus once, so only one can run.
    const runs = [
      eligible("a", "lotus", 10, [
        ["Mechy", "me"],
        ["Creed", "chris"],
      ]),
      eligible("b", "lotus", 10, [
        ["Mechy", "me"],
        ["Dwight", "dave"],
      ]),
    ];
    const { best } = planNight(runs, { minutes: 120 });
    expect(best.runs).toHaveLength(1);
  });

  it("allows the same boss twice on different characters", () => {
    const runs = [
      eligible("a", "lotus", 10, [["Mechy", "me"]]),
      eligible("b", "lotus", 10, [["Kanna", "me"]]),
    ];
    const { best } = planNight(runs, { minutes: 120 });
    expect(best.runs).toHaveLength(2);
  });

  it("takes more bosses over fewer switches, and hands back the shorter plan too", () => {
    // Three runs fit. Adding the third costs a switch, so the 2-run plan is switch-free.
    const runs = [
      eligible("a", "lotus", 10, [["Mechy", "me"]]),
      eligible("b", "damien", 10, [["Mechy", "me"]]),
      eligible("c", "lucid", 10, [["Kanna", "me"]]),
    ];
    const { best, byCount } = planNight(runs, { minutes: 120 });

    expect(best.runs).toHaveLength(3);
    expect(best.switches).toBe(1);
    expect(byCount).toHaveLength(3);
    expect(byCount[1]?.runs).toHaveLength(2);
    expect(byCount[1]?.switches).toBe(0);
  });

  it("starts each run where the one before it ended, switch or no switch", () => {
    const runs = [
      eligible("a", "lotus", 30, [["Mechy", "me"]]),
      eligible("b", "damien", 30, [["Kanna", "me"]]),
      eligible("c", "lucid", 30, [["Kanna", "me"]]),
    ];
    const { best } = planNight(runs, { minutes: 120 });
    expect(best.runs.map((r) => r.startsAt)).toEqual([0, 30, 60]);
    expect(best.minutes).toBe(90);
    expect(best.switches).toBe(1);
  });

  it("gives the same plan back for the same input", () => {
    const runs = [
      eligible("a", "lotus", 10, [["Mechy", "me"]]),
      eligible("b", "damien", 10, [["Kanna", "me"]]),
      eligible("c", "lucid", 10, [["Mechy", "me"]]),
      eligible("d", "will", 10, [["Kanna", "me"]]),
    ];
    const first = order(planNight(runs, { minutes: 120 }).best);
    const again = order(planNight([...runs].reverse(), { minutes: 120 }).best);
    expect(first).toEqual(again);
  });

  it("finds the switch-free order in a party of four with tangled characters", () => {
    // Every person has two characters; each run names one of each. A careless order relogs
    // everybody repeatedly. There is an order that costs nothing until the halfway turn.
    const runs = [
      eligible("r1", "lotus", 10, [
        ["MeA", "me"],
        ["ChrisA", "chris"],
      ]),
      eligible("r2", "damien", 10, [
        ["MeA", "me"],
        ["ChrisA", "chris"],
      ]),
      eligible("r3", "lucid", 10, [
        ["MeB", "me"],
        ["ChrisB", "chris"],
      ]),
      eligible("r4", "will", 10, [
        ["MeB", "me"],
        ["ChrisB", "chris"],
      ]),
    ];
    const { best } = planNight(runs, { minutes: 200 });
    expect(best.runs).toHaveLength(4);
    // One turn: both people move from their A character to their B character, once.
    expect(best.switches).toBe(2);
  });
});

describe("tradeOffs", () => {
  const plan = (runs: number, switches: number) =>
    ({ runs: Array.from({ length: runs }), switches, minutes: runs * 10 }) as unknown as Plan;

  it("offers the full plan on its own when nothing shorter saves a switch", () => {
    // Every length costs the same two switches, so there is no trade to make.
    expect(tradeOffs([plan(1, 2), plan(2, 2), plan(3, 2)])).toHaveLength(1);
  });

  it("offers a shorter plan that genuinely costs fewer switches", () => {
    const offered = tradeOffs([plan(1, 0), plan(2, 0), plan(3, 2)]);
    expect(offered.map((p) => p.switches)).toEqual([2, 0]);
    // The 2-run plan, not the 1-run one: both cost nothing, so the longer wins.
    expect(offered[1]?.runs).toHaveLength(2);
  });

  it("puts the longest plan first, which is the one on screen by default", () => {
    expect(tradeOffs([plan(1, 0), plan(2, 1), plan(3, 4)])[0]?.runs).toHaveLength(3);
  });

  it("has nothing to offer when there is no plan at all", () => {
    expect(tradeOffs([])).toEqual([]);
  });
});
