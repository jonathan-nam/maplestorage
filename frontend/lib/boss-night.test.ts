import { describe, expect, it } from "vitest";

import type { Party, PartyMember } from "@/types/party";

import { DEFAULT_MINUTES, minutesFor } from "./boss-minutes";
import {
  type DraftRun,
  explainRejection,
  formatDuration,
  ownerOf,
  personKey,
  rosterFrom,
  rosterFromDrafts,
  runsFromDrafts,
  planAsText,
  planGrid,
  runsFromParties,
  YOU,
} from "./boss-night";
import { planNight, screenRuns } from "./boss-run-plan";

function member(over: Partial<PartyMember> & { name: string }): PartyMember {
  return {
    id: over.name,
    personId: null,
    personName: null,
    characterId: null,
    spriteImgUrl: null,
    ...over,
  };
}

function party(id: string, bossKey: string, members: PartyMember[]): Party {
  return {
    id,
    characterId: members[0]?.characterId ?? "c1",
    worldType: "INTERACTIVE",
    bossKey,
    difficulty: null,
    members,
    pendingLoot: 0,
    awaitingPayout: 0,
    settledLoot: 0,
    cleared: null,
    clearedByHand: false,
    createdAt: "",
    updatedAt: "",
  };
}

const mine = member({ name: "Mechy", characterId: "c1" });
const chris = member({ name: "Creed", personId: "p-chris", personName: "Chris" });

describe("ownerOf", () => {
  it("calls one of your own characters yours", () => {
    expect(ownerOf(mine)).toBe(YOU);
  });

  it("calls somebody else's character theirs", () => {
    expect(ownerOf(chris)).toBe("p-chris");
  });

  it("leaves an unnamed seat unattributed rather than guessing", () => {
    expect(ownerOf(member({ name: "Stranger" }))).toBeNull();
  });

  it("trusts the roster link over a name match on the People page", () => {
    // The backend sets characterId only when the seat IS a roster character. A person link is a
    // name match, so a stray People entry naming your own character must not take it off you.
    expect(ownerOf(member({ name: "Mechy", characterId: "c1", personId: "p-chris" }))).toBe(YOU);
  });
});

describe("rosterFrom", () => {
  it("puts you first and the rest in name order", () => {
    const parties = [
      party("1", "lotus", [mine, member({ name: "Zed", personId: "p-z", personName: "Zoe" })]),
      party("2", "damien", [mine, chris]),
    ];
    expect(rosterFrom(parties)).toEqual([
      { id: YOU, name: "You" },
      { id: "p-chris", name: "Chris" },
      { id: "p-z", name: "Zoe" },
    ]);
  });

  it("names each person once however many configs they are in", () => {
    const parties = [party("1", "lotus", [mine, chris]), party("2", "damien", [mine, chris])];
    expect(rosterFrom(parties)).toHaveLength(2);
  });

  it("leaves you out when none of the configs are yours to be in", () => {
    expect(rosterFrom([party("1", "lotus", [chris])])).toEqual([{ id: "p-chris", name: "Chris" }]);
  });

  it("contributes nobody for a seat nobody has claimed", () => {
    const parties = [party("1", "lotus", [mine, member({ name: "Stranger" })])];
    expect(rosterFrom(parties)).toEqual([{ id: YOU, name: "You" }]);
  });
});

describe("runsFromParties", () => {
  const bosses = [
    { bossKey: "lotus", name: "Lotus", reset: "WEEKLY", iconUrl: null, difficulties: ["HARD"] },
  ];

  it("turns a config into a run with its seats attributed", () => {
    const runs = runsFromParties([party("1", "lotus", [mine, chris])], bosses, () => 5);
    expect(runs).toEqual([
      {
        id: "1",
        bossKey: "lotus",
        bossName: "Lotus",
        difficulty: null,
        minutes: 5,
        seats: [
          { character: "Mechy", personId: YOU },
          { character: "Creed", personId: "p-chris" },
        ],
      },
    ]);
  });

  it("keeps a config the planner will refuse, so it can say why", () => {
    const runs = runsFromParties(
      [party("1", "lotus", [mine, member({ name: "Stranger" })])],
      bosses,
      () => 5,
    );
    expect(runs).toHaveLength(1);
  });

  it("carries the mode the config says it runs", () => {
    const hard = { ...party("1", "lotus", [mine, chris]), difficulty: "HARD" };
    expect(runsFromParties([hard], bosses, () => 5)[0]?.difficulty).toBe("HARD");
  });

  it("falls back to the key when the catalog has no name for the boss", () => {
    const runs = runsFromParties([party("1", "mystery", [mine])], bosses, () => 5);
    expect(runs[0]?.bossName).toBe("mystery");
  });
});

describe("runsFromDrafts", () => {
  const draft = (seats: [string, string][]): DraftRun => ({
    id: "d1",
    bossKey: "lotus",
    bossName: "Lotus",
    minutes: 5,
    seats: seats.map(([character, person]) => ({ character, person })),
  });

  it("identifies a hand-typed person by name, however it was capitalised", () => {
    const runs = runsFromDrafts([
      draft([
        ["Mechy", "Chris"],
        ["Creed", " chris "],
      ]),
    ]);
    expect(runs[0]?.seats.map((s) => s.personId)).toEqual(["chris", "chris"]);
  });

  it("leaves a seat with no person named unattributed", () => {
    expect(runsFromDrafts([draft([["Mechy", ""]])])[0]?.seats[0]?.personId).toBeNull();
  });

  it("drops a row with no character on it, which is an unfilled form", () => {
    expect(
      runsFromDrafts([
        draft([
          ["Mechy", "Chris"],
          ["  ", "Dave"],
        ]),
      ])[0]?.seats,
    ).toHaveLength(1);
  });
});

describe("rosterFromDrafts", () => {
  it("keeps the spelling it was first given", () => {
    const drafts: DraftRun[] = [
      {
        id: "d1",
        bossKey: "lotus",
        bossName: "Lotus",
        minutes: 5,
        seats: [
          { character: "A", person: "Chris" },
          { character: "B", person: "chris" },
          { character: "C", person: "Ann" },
        ],
      },
    ];
    expect(rosterFromDrafts(drafts)).toEqual([
      { id: "ann", name: "Ann" },
      { id: "chris", name: "Chris" },
    ]);
  });
});

describe("personKey", () => {
  it("treats case and padding as typing rather than identity", () => {
    expect(personKey("  Chris ")).toBe(personKey("chris"));
  });
});

describe("minutesFor", () => {
  it("assumes the same half hour for every boss until told otherwise", () => {
    expect(minutesFor("limbo")).toBe(DEFAULT_MINUTES);
    expect(minutesFor("lotus")).toBe(minutesFor("black-mage"));
  });

  it("honours an override of zero instead of reading it as absent", () => {
    expect(minutesFor("lotus", { lotus: 0 })).toBe(0);
  });
});

describe("formatDuration", () => {
  it("says minutes, hours and both", () => {
    expect(formatDuration(45)).toBe("45m");
    expect(formatDuration(120)).toBe("2h");
    expect(formatDuration(135)).toBe("2h 15m");
  });
});

describe("explainRejection", () => {
  const roster = [{ id: "p-chris", name: "Chris" }];

  it("names both characters when one person is down for two", () => {
    expect(explainRejection("person-twice", ["Creed", "Dwight"], roster)).toContain(
      "Creed and Dwight",
    );
  });

  it("names the person who is not on", () => {
    expect(explainRejection("person-unavailable", ["p-chris"], roster)).toContain("Chris");
  });

  it("names the character nobody has claimed", () => {
    expect(explainRejection("unattributed-seat", ["Stranger"], roster)).toContain("Stranger");
  });
});

describe("planAsText", () => {
  // Built through the real planner rather than a hand-made Plan, so the text is pinned against
  // what the tool actually produces.
  const textFor = (drafts: DraftRun[], minutes: number) => {
    const roster = rosterFromDrafts(drafts);
    const { eligible } = screenRuns(
      runsFromDrafts(drafts),
      roster.map((p) => p.id),
    );
    return planAsText(planNight(eligible, { minutes }).best, roster);
  };

  const R = (id: string, bossName: string, seats: [string, string][]): DraftRun => ({
    id,
    bossKey: id,
    bossName,
    minutes: 30,
    seats: seats.map(([character, person]) => ({ character, person })),
  });

  it("names the mode in the row people copy, so nobody queues the wrong one", () => {
    const hard = { ...party("1", "lotus", [mine, chris]), difficulty: "HARD" };
    const runs = runsFromParties(
      [hard],
      [{ bossKey: "lotus", name: "Lotus", reset: "WEEKLY", iconUrl: null, difficulties: ["HARD"] }],
      () => 30,
    );
    const roster = rosterFrom([hard]);
    const { eligible } = screenRuns(
      runs,
      roster.map((p) => p.id),
    );
    const text = planAsText(planNight(eligible, { minutes: 60 }).best, roster);
    expect(text).toContain("Hard Lotus,");
  });

  it("opens with what a reader wants before they read anything else", () => {
    const text = textFor([R("1", "Lotus", [["Bishop", "You"]])], 60);
    expect(text.split("\n")[0]).toBe("1 boss · about 30m · no character switches");
  });

  it("counts bosses and switches in the plural when there is more than one", () => {
    const text = textFor(
      [
        R("1", "Lotus", [["Bishop", "You"]]),
        R("2", "Damien", [["Kanna", "You"]]),
        R("3", "Lucid", [["Hero", "You"]]),
      ],
      180,
    );
    expect(text.split("\n")[0]).toContain("3 bosses");
    expect(text.split("\n")[0]).toContain("2 character switches");
  });

  /** The rows between the fences, which is the table itself. */
  const fenced = (text: string) => {
    const lines = text.split("\n");
    const open = lines.indexOf("```");
    const close = lines.indexOf("```", open + 1);
    expect(open).toBeGreaterThan(-1);
    expect(close).toBeGreaterThan(open);
    return lines.slice(open + 1, close);
  };

  /** The three-run night the size rule splits Dave's runs across. Rows: Lotus, Damien, Lucid. */
  const SPLIT_NIGHT = [
    R("1", "Lotus", [
      ["Bishop", "You"],
      ["Nightlord", "Dave"],
      ["Shadower", "Erin"],
    ]),
    R("2", "Damien", [
      ["Bishop", "You"],
      ["Shadower", "Erin"],
    ]),
    R("3", "Lucid", [["Nightlord", "Dave"]]),
  ];

  it("heads the columns with people and the rows with bosses", () => {
    const table = fenced(textFor(SPLIT_NIGHT, 180));
    expect(table[0]).toMatch(/^Boss,\s+Dave,\s+Erin,\s+You$/);
    expect(table[1]).toMatch(/^Lotus,\s+Nightlord,\s+Shadower,\s+Bishop$/);
  });

  it("marks somebody sitting a run out with an X", () => {
    // Dave is in the first and last runs and out of the middle one. The night has to run
    // 3-person, 2-person, 1-person for size, which outranks keeping his two runs together, so
    // this is the gap the planner cannot close and the one the X has to show.
    const table = fenced(textFor(SPLIT_NIGHT, 180));
    expect(table[2]).toMatch(/^Damien,\s+X,\s+Shadower,\s+Bishop$/);
    expect(table[3]).toMatch(/^Lucid,\s+Nightlord,\s+X,\s+X$/);
  });

  it("lines the columns up, so the grid survives being pasted", () => {
    const table = fenced(textFor(SPLIT_NIGHT, 180));
    const firstColumn = (line: string) => (/^[^,]*,\s*/.exec(line) as RegExpExecArray)[0].length;
    expect(new Set(table.map(firstColumn)).size).toBe(1);
  });

  it("says what the marks mean, because a reader of the paste did not choose them", () => {
    expect(textFor(SPLIT_NIGHT, 180)).toContain("X = sitting out.");
    expect(
      textFor([R("1", "Lotus", [["Bishop", "You"]]), R("2", "Damien", [["Kanna", "You"]])], 120),
    ).toContain("* = switches character.");
  });

  it("says nothing about marks it did not use", () => {
    // One person, one boss: nobody sits out and nobody switches, so there is nothing to explain.
    const text = textFor([R("1", "Lotus", [["Bishop", "You"]])], 60);
    expect(text).not.toContain("=");
  });

  it("marks the character somebody changed to, and no other", () => {
    const table = fenced(
      textFor([R("1", "Lotus", [["Bishop", "You"]]), R("2", "Damien", [["Kanna", "You"]])], 120),
    );
    expect(table[2]).toContain("Kanna*");
    // The first run is not a switch. Logging in is not changing character, so the cell is bare.
    expect(table[1]).not.toContain("Bishop*");
  });

  it("gives no column to somebody who is in no scheduled run", () => {
    // Only one boss fits, and it is not the one Dave is in. His run is named in the leftovers on
    // screen, so a column of nothing but X would be a second telling and a wasted column.
    const text = textFor(
      [R("1", "Lotus", [["Bishop", "You"]]), R("2", "Damien", [["Nightlord", "Dave"]])],
      30,
    );
    expect(text).not.toContain("Dave");
  });

  it("keeps the rows in the order the night runs", () => {
    const table = fenced(
      textFor([R("1", "Lotus", [["Bishop", "You"]]), R("2", "Damien", [["Bishop", "You"]])], 120),
    );
    expect(table[1]).toMatch(/^Lotus,/);
    expect(table[2]).toMatch(/^Damien,/);
  });

  it("calls a boss what the party calls it", () => {
    const text = textFor(
      [
        R("malefic-star", "Malefic Star", [["Bishop", "You"]]),
        R("kalos-the-guardian", "Kalos the Guardian", [["Bishop", "You"]]),
      ],
      120,
    );
    expect(text).toContain("Star,");
    expect(text).toContain("Kalos,");
    expect(text).not.toContain("Malefic");
    expect(text).not.toContain("Guardian");
  });

  it("keeps the full name for a boss with no shorthand", () => {
    const table = fenced(textFor([R("lotus", "Lotus", [["Bishop", "You"]])], 60));
    expect(table[1]).toBe("Lotus, Bishop");
  });

  it("quotes a name holding a comma, so one typed by hand cannot split a row", () => {
    const table = fenced(textFor([R("1", "Lotus", [["Bishop", "Dave, Jr"]])], 60));
    expect(table[0]).toBe('Boss,  "Dave, Jr"');
  });

  it("says so plainly when there is nothing to paste", () => {
    expect(planAsText({ runs: [], switches: 0, minutes: 0 }, [])).toBe(
      "No bosses fit in the time.",
    );
  });

  it("indents nothing, so the table holds up even without its fence", () => {
    const text = textFor(
      [
        R("1", "Lotus", [
          ["Bishop", "You"],
          ["Hero", "Chris"],
        ]),
      ],
      60,
    );
    expect(text.split("\n").every((line) => line === line.trimStart())).toBe(true);
  });
});

describe("planGrid", () => {
  const R = (id: string, bossName: string, seats: [string, string][]): DraftRun => ({
    id,
    bossKey: id,
    bossName,
    minutes: 30,
    seats: seats.map(([character, person]) => ({ character, person })),
  });

  const gridFor = (drafts: DraftRun[], minutes: number) => {
    const roster = rosterFromDrafts(drafts);
    const { eligible } = screenRuns(
      runsFromDrafts(drafts),
      roster.map((p) => p.id),
    );
    return planGrid(planNight(eligible, { minutes }).best, roster);
  };

  it("gives every row a cell per person, whether or not they are in the run", () => {
    const { people, rows } = gridFor(
      [
        R("1", "Lotus", [
          ["Bishop", "You"],
          ["Nightlord", "Dave"],
        ]),
        R("2", "Damien", [["Bishop", "You"]]),
      ],
      120,
    );
    expect(people.map((person) => person.name)).toEqual(["Dave", "You"]);
    expect(rows.every((row) => row.cells.length === people.length)).toBe(true);
  });

  it("empties the cell of somebody sitting the run out, rather than dropping it", () => {
    const { rows } = gridFor(
      [
        R("1", "Lotus", [
          ["Bishop", "You"],
          ["Nightlord", "Dave"],
        ]),
        R("2", "Damien", [["Bishop", "You"]]),
      ],
      120,
    );
    // Dave is the first column, and the second run is not his.
    expect(rows[1]?.cells[0]).toEqual({ character: null, switched: false });
  });

  it("flags the cell somebody changed character to, and not the run before it", () => {
    const { rows } = gridFor(
      [R("1", "Lotus", [["Bishop", "You"]]), R("2", "Damien", [["Kanna", "You"]])],
      120,
    );
    expect(rows[0]?.cells[0]).toEqual({ character: "Bishop", switched: false });
    expect(rows[1]?.cells[0]).toEqual({ character: "Kanna", switched: true });
  });

  it("holds no column for somebody the plan never uses", () => {
    const { people } = gridFor(
      [R("1", "Lotus", [["Bishop", "You"]]), R("2", "Damien", [["Nightlord", "Dave"]])],
      30,
    );
    expect(people.map((person) => person.name)).toEqual(["You"]);
  });
});
