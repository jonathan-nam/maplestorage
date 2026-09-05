import { describe, expect, it } from "vitest";
import { yourClear } from "./shared-parties";
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

const party = (seats: PartyMember[], mySeatIds: string[]): SeatedParty => ({
  id: "pa-1",
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
