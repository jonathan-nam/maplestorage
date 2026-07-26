import { describe, expect, it } from "vitest";
import {
  byBoss,
  byCharacter,
  bossesWithoutConfig,
  otherMembers,
  partyLabel,
  partySizeLabel,
} from "./parties";
import type { Boss } from "@/types/boss";
import type { Party, PartyMember } from "@/types/party";

const seat = (name: string, characterId: string | null = null): PartyMember => ({
  id: `seat-${name}`,
  name,
  personId: null,
  personName: null,
  characterId,
  spriteImgUrl: null,
});

const boss = (bossKey: string, name: string): Boss => ({
  bossKey,
  name,
  reset: "WEEKLY",
  iconUrl: `/boss-icons/${bossKey}.png`,
});

const config = (
  id: string,
  characterId: string,
  bossKey: string,
  others: string[],
  name: string | null = null,
): Party => ({
  id,
  characterId,
  bossKey,
  name,
  members: [seat("mine", characterId), ...others.map((o) => seat(o))],
  pendingLoot: 0,
  awaitingPayout: 0,
  createdAt: "2026-07-26T00:00:00Z",
  updatedAt: "2026-07-26T00:00:00Z",
});

describe("otherMembers", () => {
  it("leaves your own character out, because the config already is that character", () => {
    const party = config("p1", "char-1", "limbo", ["CreedBratton"]);
    expect(otherMembers(party).map((m) => m.name)).toEqual(["CreedBratton"]);
  });
});

describe("partyLabel", () => {
  it("falls back to who is in it, not to the boss", () => {
    // The boss is already the heading wherever a config is drawn, so naming it again says nothing
    // twice.
    expect(partyLabel(config("p1", "c1", "limbo", ["CreedBratton", "Lynn"]))).toBe(
      "CreedBratton + Lynn",
    );
    expect(partyLabel(config("p1", "c1", "limbo", ["Lynn"], "  carry  "))).toBe("carry");
  });
});

describe("partySizeLabel", () => {
  it("uses the words people actually use, and counts past where they run out", () => {
    expect(partySizeLabel(2)).toBe("Duo");
    expect(partySizeLabel(3)).toBe("Trio");
    expect(partySizeLabel(6)).toBe("6-man");
  });
});

describe("byCharacter", () => {
  it("groups in roster order and leaves out characters with nothing", () => {
    const a = config("p1", "char-1", "limbo", ["X"]);
    const b = config("p2", "char-2", "limbo", ["Y"]);
    const groups = byCharacter([a, b], ["char-2", "char-1", "char-3"]);

    expect(groups.map((g) => g.key)).toEqual(["char-2", "char-1"]);
    expect(groups[0]?.parties).toEqual([b]);
  });
});

describe("byBoss", () => {
  it("groups in catalog order, with two characters on one boss together", () => {
    const catalog = [boss("limbo", "Limbo"), boss("baldrix", "Baldrix")];
    const mech = config("p1", "char-1", "baldrix", ["X"]);
    const warrior = config("p2", "char-2", "limbo", ["Y"]);
    const third = config("p3", "char-3", "limbo", ["Z"]);

    const groups = byBoss([mech, warrior, third], catalog);
    expect(groups.map((g) => g.key.bossKey)).toEqual(["limbo", "baldrix"]);
    expect(groups[0]?.parties.map((p) => p.id)).toEqual(["p2", "p3"]);
  });
});

describe("bossesWithoutConfig", () => {
  it("offers only the bosses this character has no config for yet", () => {
    // One config per character per boss, so the ones already taken cannot be added again. That is
    // the same rule the server enforces, kept off the dropdown rather than shown as an error.
    const catalog = [boss("limbo", "Limbo"), boss("baldrix", "Baldrix")];
    const taken = config("p1", "char-1", "limbo", ["X"]);

    expect(bossesWithoutConfig([taken], catalog, "char-1").map((b) => b.bossKey)).toEqual([
      "baldrix",
    ]);
    // Another character of yours can still run it.
    expect(bossesWithoutConfig([taken], catalog, "char-2").map((b) => b.bossKey)).toEqual([
      "limbo",
      "baldrix",
    ]);
  });
});
