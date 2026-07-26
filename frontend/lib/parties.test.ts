import { describe, expect, it } from "vitest";
import {
  bossesWithoutConfig,
  byBoss,
  byCharacter,
  consolidate,
  filterByClear,
  isCleared,
  otherMembers,
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

const config = (id: string, characterId: string, bossKey: string, others: string[]): Party => ({
  id,
  characterId,
  bossKey,
  members: [seat("mine", characterId), ...others.map((o) => seat(o))],
  pendingLoot: 0,
  awaitingPayout: 0,
  settledLoot: 0,
  cleared: null,
  clearedByHand: false,
  createdAt: "2026-07-26T00:00:00Z",
  updatedAt: "2026-07-26T00:00:00Z",
});

describe("otherMembers", () => {
  it("leaves your own character out, because the config already is that character", () => {
    const party = config("p1", "char-1", "limbo", ["CreedBratton"]);
    expect(otherMembers(party).map((m) => m.name)).toEqual(["CreedBratton"]);
  });
});

describe("partySizeLabel", () => {
  it("uses the words people actually use, and counts past where they run out", () => {
    expect(partySizeLabel(2)).toBe("Duo");
    expect(partySizeLabel(3)).toBe("Trio");
    expect(partySizeLabel(6)).toBe("6-man");
  });
});

describe("filterByClear", () => {
  const cleared = { ...config("p1", "char-1", "limbo", ["X"]), cleared: true };
  const notCleared = { ...config("p2", "char-1", "kalos", ["X"]), cleared: false };
  const unreported = config("p3", "char-1", "baldrix", ["X"]);

  it("keeps everything under all", () => {
    expect(filterByClear([cleared, notCleared, unreported], "all")).toHaveLength(3);
  });

  it("counts an unreported boss as not cleared, not as cleared", () => {
    // The failure this guards: a week where nothing has been captured yet reads as a fully
    // cleared week, and the list of what is left comes back empty.
    expect(isCleared(unreported)).toBe(false);
    expect(
      filterByClear([cleared, notCleared, unreported], "not-cleared").map((p) => p.id),
    ).toEqual(["p2", "p3"]);
    expect(filterByClear([cleared, notCleared, unreported], "cleared").map((p) => p.id)).toEqual([
      "p1",
    ]);
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

describe("consolidate", () => {
  it("merges the same roster across bosses into one arrangement", () => {
    // A duo with CreedBratton on three bosses is one arrangement and three runs. Each keeps its
    // own config, because each has its own loot pool.
    const kalos = config("p1", "char-1", "kalos", ["CreedBratton"]);
    const adversary = config("p2", "char-1", "first-adversary", ["CreedBratton"]);
    const baldrix = config("p3", "char-1", "baldrix", ["CreedBratton"]);

    const merged = consolidate([kalos, adversary, baldrix], ["char-1"]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.parties.map((p) => p.bossKey)).toEqual([
      "kalos",
      "first-adversary",
      "baldrix",
    ]);
  });

  it("treats the same people in another order as the same arrangement", () => {
    const one = config("p1", "char-1", "kalos", ["Lynn", "Kaiser"]);
    const two = config("p2", "char-1", "limbo", ["kaiser", "lynn"]);
    expect(consolidate([one, two], ["char-1"])).toHaveLength(1);
  });

  it("keeps different rosters and different characters apart", () => {
    const duo = config("p1", "char-1", "kalos", ["CreedBratton"]);
    const trio = config("p2", "char-1", "limbo", ["CreedBratton", "Lynn"]);
    // Same roster, but somebody else's character runs it: two arrangements, because the question
    // is what THIS character runs with.
    const otherCharacter = config("p3", "char-2", "kalos", ["CreedBratton"]);

    expect(consolidate([duo, trio, otherCharacter], ["char-1", "char-2"])).toHaveLength(3);
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
