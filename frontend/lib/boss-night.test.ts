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
    bossKey,
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
  const bosses = [{ bossKey: "lotus", name: "Lotus", reset: "WEEKLY", iconUrl: null }];

  it("turns a config into a run with its seats attributed", () => {
    const runs = runsFromParties([party("1", "lotus", [mine, chris])], bosses, () => 5);
    expect(runs).toEqual([
      {
        id: "1",
        bossKey: "lotus",
        bossName: "Lotus",
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

  it("gives somebody who never moves one line and no run numbers to check off", () => {
    const text = textFor(
      [R("1", "Lotus", [["Hero", "Chris"]]), R("2", "Damien", [["Hero", "Chris"]])],
      120,
    );
    expect(text).toContain("Chris: Hero the whole way");
  });

  it("says where a switch falls, in the order the night runs", () => {
    const text = textFor(
      [
        R("1", "Lotus", [["Bishop", "You"]]),
        R("2", "Damien", [["Bishop", "You"]]),
        R("3", "Lucid", [["Kanna", "You"]]),
      ],
      180,
    );
    expect(text).toContain("You: Bishop for 1-2, then Kanna for 3");
  });

  it("compresses a run of consecutive numbers and comma-separates a gap", () => {
    // Dave sits out the middle boss, so his numbers cannot be a range. The night has to run
    // 3-person, 2-person, 1-person for size, which is the one thing that outranks keeping Dave's
    // two runs together, so this gap is the rare one the planner cannot close.
    const text = textFor(
      [
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
      ],
      180,
    );
    expect(text).toContain("Dave: Nightlord for 1, 3");
    expect(text).toContain("You: Bishop for 1-2");
  });

  it("leaves out somebody who is in no scheduled run", () => {
    // Only one boss fits, and it is not the one Dave is in.
    const text = textFor(
      [R("1", "Lotus", [["Bishop", "You"]]), R("2", "Damien", [["Nightlord", "Dave"]])],
      30,
    );
    expect(text).not.toContain("Dave");
  });

  it("lists the bosses in order, numbered to match the lines below", () => {
    const text = textFor(
      [R("1", "Lotus", [["Bishop", "You"]]), R("2", "Damien", [["Bishop", "You"]])],
      120,
    );
    expect(text).toContain("1. Lotus");
    expect(text).toContain("2. Damien");
  });

  it("says so plainly when there is nothing to paste", () => {
    expect(planAsText({ runs: [], switches: 0, minutes: 0 }, [])).toBe(
      "No bosses fit in the time.",
    );
  });

  it("indents nothing, because a chat client will not render it monospaced", () => {
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
