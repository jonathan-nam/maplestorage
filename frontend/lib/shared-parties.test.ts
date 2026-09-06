import { describe, expect, it } from "vitest";
import { bySeatedCharacter, yourClear, yourSeat } from "./shared-parties";
import type { PartyMember, SeatedParty } from "@/types/party";

const seat = (id: string, name: string, linkedCharacterId: string | null = null): PartyMember => ({
  id,
  name,
  personId: null,
  personName: null,
  characterId: null,
  linkedCharacterId,
  spriteImgUrl: null,
  guest: false,
  shares: 1,
});

const party = (seats: PartyMember[], mySeatIds: string[], id = "pa-1"): SeatedParty => ({
  id,
  bossKey: "kalos-the-guardian",
  difficulty: "CHAOS",
  minutes: null,
  seats,
  mySeatIds,
  nights: [],
});

// The owner's seat, then mine bound to a character on my own account.
const theirs = seat("s-owner", "mechyfechy");
const mine = seat("s-mine", "CreedBratton", "char-mine");
const shared = party([theirs, mine], ["s-mine"]);

describe("yourClear", () => {
  it("answers for YOUR character, not the party's owner", () => {
    // The owner's character has cleared and mine has not. The card asks "have I", so this is false:
    // reading the owner's tick would tell me somebody else's night.
    const clears = new Map([
      ["char-theirs", new Map([["kalos-the-guardian", true]])],
      ["char-mine", new Map([["kalos-the-guardian", false]])],
    ]);
    expect(yourClear(shared, clears)).toBe(false);
  });

  it("is true when my own character has cleared it", () => {
    const clears = new Map([["char-mine", new Map([["kalos-the-guardian", true]])]]);
    expect(yourClear(shared, clears)).toBe(true);
  });

  it("is null when no capture has mentioned the boss", () => {
    const clears = new Map([["char-mine", new Map([["limbo", true]])]]);
    expect(yourClear(shared, clears)).toBeNull();
  });

  // Every seat until an invite is accepted. Nothing is claimed either way rather than a false
  // "not cleared", which would read as a night this account had been asked about and had not run.
  it("is null when my seat has no character bound to it", () => {
    const unbound = party([theirs, seat("s-mine", "CreedBratton")], ["s-mine"]);
    const clears = new Map([["char-mine", new Map([["kalos-the-guardian", true]])]]);
    expect(yourClear(unbound, clears)).toBeNull();
  });

  it("is null when none of the seats are mine", () => {
    expect(yourClear(party([theirs], []), new Map())).toBeNull();
  });
});

describe("yourSeat", () => {
  it("finds the seat one of your characters holds, not the owner's", () => {
    expect(yourSeat(shared)?.name).toBe("CreedBratton");
  });

  // A guess about whose seat it is is a guess about whose share it is.
  it("is null rather than a guess when no seat is yours", () => {
    expect(yourSeat(party([theirs], []))).toBeNull();
  });
});

describe("bySeatedCharacter", () => {
  const seatOn = (id: string, name: string, characterId: string) => seat(id, name, characterId);
  const on = (character: string, id: string) => {
    const ours = seatOn(`s-${id}`, character, `char-${character}`);
    return party([theirs, ours], [ours.id], id);
  };

  // Jonathan's real shape: three characters of the member's across seventeen of somebody else's
  // parties. Seventeen cards in a row say nothing about which character has a night tonight.
  it("files each party under the character of yours that sits in it", () => {
    const groups = bySeatedCharacter(
      [on("Freeballynn", "p1"), on("iPhone69C", "p2"), on("Freeballynn", "p3")],
      ["char-Freeballynn", "char-iPhone69C"],
    );
    expect(groups.map((g) => [g.name, g.parties.length])).toEqual([
      ["Freeballynn", 2],
      ["iPhone69C", 1],
    ]);
  });

  // So the shared list and your own read down the page the same way.
  it("takes your own character order, not the order the parties arrived in", () => {
    const groups = bySeatedCharacter(
      [on("iPhone69C", "p1"), on("Freeballynn", "p2")],
      ["char-Freeballynn", "char-iPhone69C"],
    );
    expect(groups.map((g) => g.name)).toEqual(["Freeballynn", "iPhone69C"]);
  });

  // A shorter list that looks complete is worse than a heading with no name behind it. This is
  // reachable through a cached character list that predates a character (see #613).
  it("puts a party it cannot place last rather than dropping it", () => {
    const stray = party([theirs, seat("s-x", "CourseLair")], ["s-x"], "p9");
    const groups = bySeatedCharacter([stray, on("Freeballynn", "p1")], ["char-Freeballynn"]);
    expect(groups.map((g) => g.name)).toEqual(["Freeballynn", "CourseLair"]);
    expect(groups.flatMap((g) => g.parties).length).toBe(2);
  });

  it("keeps a character your order has not heard of, after the ones it has", () => {
    const groups = bySeatedCharacter(
      [on("iPhone69C", "p1"), on("Freeballynn", "p2")],
      ["char-Freeballynn"],
    );
    expect(groups.map((g) => g.name)).toEqual(["Freeballynn", "iPhone69C"]);
  });

  it("has nothing to group when nothing is shared", () => {
    expect(bySeatedCharacter([], ["char-Freeballynn"])).toEqual([]);
  });
});
