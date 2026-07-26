import { describe, expect, it } from "vitest";
import {
  bossesFor,
  expandParties,
  partiesByCharacter,
  partyLabel,
  partySizeLabel,
} from "./parties";
import type { Boss } from "@/types/boss";
import type { Party, PartyMember } from "@/types/party";

const seat = (name: string, characterId: string | null = null): PartyMember => ({
  id: `seat-${name}`,
  personId: `person-${name}`,
  name,
  ign: null,
  characterId,
  mvp: false,
  spriteImgUrl: null,
});

const party = (id: string, members: PartyMember[], name: string | null = null): Party => ({
  id,
  name,
  members,
  bossKeys: [],
  pendingLoot: 0,
  awaitingPayout: 0,
  createdAt: "2026-07-26T00:00:00Z",
  updatedAt: "2026-07-26T00:00:00Z",
});

describe("partyLabel", () => {
  it("falls back to the roster when the party was never named", () => {
    expect(partyLabel(party("p1", [seat("Rune"), seat("Steve")]))).toBe("Rune + Steve");
  });

  it("prefers the name it was given, trimmed", () => {
    expect(partyLabel(party("p1", [seat("Rune")], "  Kalos duo  "))).toBe("Kalos duo");
  });

  it("does not label a whitespace name as a name", () => {
    // A name of spaces is the same as no name. Labelling one "   " would leave a card with no
    // visible title and no way to tell which party it is.
    expect(partyLabel(party("p1", [seat("Rune")], "   "))).toBe("Rune");
  });
});

describe("partySizeLabel", () => {
  it("uses the words people actually use, and counts past where they run out", () => {
    expect(partySizeLabel(2)).toBe("Duo");
    expect(partySizeLabel(3)).toBe("Trio");
    expect(partySizeLabel(6)).toBe("6-man");
    expect(partySizeLabel(1)).toBe("Solo");
  });
});

describe("partiesByCharacter", () => {
  const rune = party("p1", [seat("Rune", "char-1"), seat("Steve")]);
  const shared = party("p2", [seat("Rune", "char-1"), seat("Mule", "char-2")]);
  const strangers = party("p3", [seat("Steve"), seat("Bob")]);

  it("lists a party under every one of your characters that sits in it", () => {
    // One party, two of the account's characters. Showing it under only the first would hide a
    // party the second character really is in, which is the question this page exists to answer.
    const groups = partiesByCharacter([rune, shared, strangers], ["char-1", "char-2"]);

    expect(groups.map((g) => g.characterId)).toEqual(["char-1", "char-2", null]);
    expect(groups[0]?.parties.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(groups[1]?.parties.map((p) => p.id)).toEqual(["p2"]);
  });

  it("puts parties with none of your characters in them last, not nowhere", () => {
    const groups = partiesByCharacter([strangers], ["char-1"]);
    expect(groups).toEqual([{ characterId: null, parties: [strangers] }]);
  });

  it("follows the character order it is given, not the order the parties arrived in", () => {
    const groups = partiesByCharacter([shared], ["char-2", "char-1"]);
    expect(groups.map((g) => g.characterId)).toEqual(["char-2", "char-1"]);
  });

  it("leaves a character with no parties out rather than showing an empty group", () => {
    expect(partiesByCharacter([], ["char-1"])).toEqual([]);
  });
});

describe("expandParties", () => {
  const boss = (bossKey: string, name: string): Boss => ({
    bossKey,
    name,
    reset: "WEEKLY",
    iconUrl: `/boss-icons/${bossKey}.png`,
  });
  const catalog = [boss("limbo", "Limbo"), boss("baldrix", "Baldrix")];
  const duo = {
    ...party("p1", [seat("morebuff12", "char-1"), seat("Lynn")]),
    bossKeys: ["baldrix", "limbo"],
  };

  it("leaves parties alone when neither axis is on", () => {
    const rows = expandParties([duo], catalog, ["char-1"], { byBoss: false, byCharacter: false });
    expect(rows).toEqual([{ party: duo, boss: null, characterId: null }]);
  });

  it("splits by boss, in catalog order", () => {
    // The duo that does two bosses is two things to do, and the question on the night is "who am I
    // doing Limbo with", not "which party contains Limbo".
    const rows = expandParties([duo], catalog, ["char-1"], { byBoss: true, byCharacter: false });
    expect(rows.map((r) => r.boss?.key)).toEqual(["limbo", "baldrix"]);
    expect(rows.every((r) => r.characterId === null)).toBe(true);
  });

  it("splits by character, in roster order", () => {
    const rows = expandParties([duo], catalog, ["char-1"], { byBoss: false, byCharacter: true });
    expect(rows).toEqual([{ party: duo, boss: null, characterId: "char-1" }]);
  });

  it("gives one row per character-boss pair when both are on", () => {
    const rows = expandParties([duo], catalog, ["char-1"], { byBoss: true, byCharacter: true });
    expect(rows.map((r) => [r.characterId, r.boss?.key])).toEqual([
      ["char-1", "limbo"],
      ["char-1", "baldrix"],
    ]);
  });

  it("keeps a party that has nothing on the axis being split by", () => {
    // A party with no boss yet, split by boss, still has to appear: a row that vanished because it
    // had no value on an axis is a party you own and cannot see.
    const unassigned = party("p2", [seat("Steve")]);
    const rows = expandParties([unassigned], catalog, ["char-1"], {
      byBoss: true,
      byCharacter: true,
    });
    expect(rows).toEqual([{ party: unassigned, boss: null, characterId: null }]);
  });

  it("sorts by character first, so both axes read as one character's night", () => {
    const other = { ...party("p3", [seat("acornacorn", "char-2")]), bossKeys: ["limbo"] };
    const rows = expandParties([duo, other], catalog, ["char-2", "char-1"], {
      byBoss: true,
      byCharacter: true,
    });
    expect(rows.map((r) => r.characterId)).toEqual(["char-2", "char-1", "char-1"]);
  });
});

describe("bossesFor", () => {
  it("shows a key it cannot name rather than dropping it", () => {
    // A missing entry means the catalog changed. A shortened boss list would say this party runs
    // fewer bosses than it does, which is the quiet kind of wrong.
    const baldrix: Boss = {
      bossKey: "baldrix",
      name: "Baldrix",
      reset: "WEEKLY",
      iconUrl: "/boss-icons/baldrix.png",
    };
    const p = { ...party("p1", []), bossKeys: ["baldrix", "mystery-boss"] };
    expect(bossesFor(p, new Map([["baldrix", baldrix]]))).toEqual([
      { key: "baldrix", name: "Baldrix", iconUrl: "/boss-icons/baldrix.png" },
      { key: "mystery-boss", name: "mystery-boss", iconUrl: null },
    ]);
  });
});
