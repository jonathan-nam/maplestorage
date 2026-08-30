import { describe, expect, it } from "vitest";
import { type PersonDraft, claim, isRegular, unclaimed } from "./people-board";
import type { Party, PartyMember } from "@/types/party";

const seat = (name: string, guest = false): PartyMember => ({
  id: `m-${name}`,
  name,
  personId: null,
  personName: null,
  characterId: null,
  spriteImgUrl: null,
  guest,
  shares: 1,
});

const party = (seats: PartyMember[], over: Partial<Party> = {}): Party => ({
  id: `pa-${seats.map((s) => s.name).join("-")}`,
  slug: "pa",
  characterId: "char-1",
  solo: false,
  retired: false,
  worldType: "INTERACTIVE",
  bossKey: "kalos-the-guardian",
  difficulty: "CHAOS",
  minutes: null,
  members: seats,
  seats,
  looterMemberId: null,
  usualRoster: true,
  skippedThisPeriod: false,
  oneOff: false,
  pendingLoot: 0,
  awaitingPayout: 0,
  settledLoot: 0,
  cleared: null,
  clearedByHand: false,
  createdAt: "2026-07-01T00:00:00Z",
  updatedAt: "2026-07-01T00:00:00Z",
  ...over,
});

const person = (name: string, characters: string[]): PersonDraft => ({
  id: `p-${name}`,
  name,
  characters,
});

describe("isRegular", () => {
  it("counts a standing seat in a standing party", () => {
    expect(isRegular("Premial", [party([seat("Premial")])])).toBe(true);
  });

  // The point of the flag rule over a count: one party is the whole arrangement for a duo.
  it("counts somebody who is in exactly one party", () => {
    const parties = [party([seat("mechyfechy"), seat("Premial")])];
    expect(isRegular("Premial", parties)).toBe(true);
  });

  it("does not count a guest seat", () => {
    expect(isRegular("Dwight", [party([seat("Dwight", true)])])).toBe(false);
  });

  it("does not count a seat in a one-off party", () => {
    expect(isRegular("Dwight", [party([seat("Dwight")], { oneOff: true })])).toBe(false);
  });

  it("counts somebody who is a guest in one party and a regular in another", () => {
    const parties = [party([seat("Dwight", true)]), party([seat("Dwight")])];
    expect(isRegular("Dwight", parties)).toBe(true);
  });

  it("matches the name case-insensitively", () => {
    expect(isRegular("PREMIAL", [party([seat("Premial")])])).toBe(true);
  });
});

describe("unclaimed", () => {
  const parties = [
    party([seat("mechyfechy"), seat("Premial")]),
    party([seat("mechyfechy"), seat("Dwight", true)], { id: "pa-2" }),
  ];

  it("leaves out whoever a person already holds", () => {
    const { regular } = unclaimed(parties, [person("Jared", ["Premial"])]);
    expect(regular).toEqual(["mechyfechy"]);
  });

  it("puts a guest under one-off rather than dropping them", () => {
    const { regular, oneOff } = unclaimed(parties, []);
    expect(regular).toEqual(["mechyfechy", "Premial"]);
    expect(oneOff).toEqual(["Dwight"]);
  });

  it("names a character once however many parties they are in", () => {
    const { regular } = unclaimed(parties, []);
    expect(regular.filter((n) => n === "mechyfechy")).toHaveLength(1);
  });

  it("leaves out a character claimed under a different case", () => {
    const { regular, oneOff } = unclaimed(parties, [person("Jared", ["premial"])]);
    expect([...regular, ...oneOff]).not.toContain("Premial");
  });

  it("reads every seat, not just the week's roster", () => {
    const departed = party([seat("mechyfechy")], { seats: [seat("mechyfechy"), seat("Lynn")] });
    expect(unclaimed([departed], []).regular).toContain("Lynn");
  });
});

describe("claim", () => {
  const people = [person("Jared", ["Premial"]), person("Chris", [])];

  it("gives a character to a person", () => {
    expect(claim(people, "Lynn", 1)[1]!.characters).toEqual(["Lynn"]);
  });

  it("moves rather than duplicates, so nobody can claim it twice", () => {
    const moved = claim(people, "Premial", 1);
    expect(moved[0]!.characters).toEqual([]);
    expect(moved[1]!.characters).toEqual(["Premial"]);
  });

  it("moves a character named in a different case", () => {
    expect(claim(people, "PREMIAL", 1)[0]!.characters).toEqual([]);
  });

  it("takes a character back off everybody", () => {
    expect(claim(people, "Premial", null)[0]!.characters).toEqual([]);
  });

  it("leaves the list alone rather than unclaiming when the row is gone", () => {
    expect(claim(people, "Premial", 7)).toEqual(people);
  });
});
