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
  runsFromParties,
  YOU,
} from "./boss-night";

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
