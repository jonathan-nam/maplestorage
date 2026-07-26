import { describe, expect, it } from "vitest";
import { bossNamesFor, partiesByCharacter, partyLabel, partySizeLabel } from "./parties";
import type { Party, PartyMember } from "@/types/party";

const seat = (name: string, characterId: string | null = null): PartyMember => ({
  id: `seat-${name}`,
  name,
  characterId,
  mvp: false,
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

describe("bossNamesFor", () => {
  it("shows a key it cannot name rather than dropping it", () => {
    // A missing name means the catalog changed. A shortened boss list would say this party runs
    // fewer bosses than it does, which is the quiet kind of wrong.
    const names = new Map([["baldrix", "Baldrix"]]);
    const p = { ...party("p1", []), bossKeys: ["baldrix", "mystery-boss"] };
    expect(bossNamesFor(p, names)).toEqual(["Baldrix", "mystery-boss"]);
  });
});
