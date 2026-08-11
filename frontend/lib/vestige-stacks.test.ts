import { describe, expect, it } from "vitest";
import {
  assignableDrops,
  assignedStacks,
  openingCounts,
  pieceDrift,
  stacksToSave,
} from "./vestige-stacks";
import type { Loot } from "@/types/loot";
import type { Party, PartyMember } from "@/types/party";

const VESTIGE = "vestige-of-erion";
const WEEK = "2026-08-06";

const seat = (
  id: string,
  name: string,
  { mine = false, person = null as string | null } = {},
): PartyMember => ({
  id,
  name,
  personId: person,
  personName: person ? "Bro" : null,
  characterId: mine ? `char-${id}` : null,
  spriteImgUrl: null,
  guest: false,
  shares: 1,
});

const party = (seats: PartyMember[], over: Partial<Party> = {}): Party => ({
  id: "pa",
  characterId: seats[0]!.characterId ?? `char-${seats[0]!.id}`,
  solo: false,
  oneOff: false,
  retired: false,
  worldType: "INTERACTIVE",
  bossKey: "limbo",
  difficulty: "HARD",
  minutes: null,
  looterMemberId: null,
  members: seats,
  seats,
  usualRoster: true,
  skippedThisPeriod: false,
  pendingLoot: 0,
  awaitingPayout: 0,
  settledLoot: 0,
  cleared: null,
  clearedByHand: false,
  createdAt: "2026-07-01T00:00:00Z",
  updatedAt: "2026-07-01T00:00:00Z",
  ...over,
});

const coupon = (over: Partial<Loot> = {}): Loot => ({
  id: "l1",
  dropKey: VESTIGE,
  customName: null,
  name: "Vestige of Erion Coupon",
  iconUrl: null,
  perMember: null,
  bossKey: "limbo",
  quantity: 180,
  droppedOn: WEEK,
  weekStart: WEEK,
  status: "PENDING",
  saleAmount: null,
  amountBasis: null,
  splitMethod: null,
  sellerShares: null,
  sellerMemberId: null,
  takenByMemberId: null,
  soldAt: null,
  payouts: [],
  ranThatWeek: ["m1", "m2", "m3"],
  bundles: 3,
  bundlesBy: [],
  ...over,
});

/** Your character and two strangers, on a boss that drops 180 in 3 stacks of 60. */
const trio = () => [seat("m1", "Husky", { mine: true }), seat("m2", "Rune"), seat("m3", "Bob")];

describe("which nights can be handed out", () => {
  it("takes this week's coupon drop, with its stack size worked out", () => {
    const [drop] = assignableDrops(party(trio()), [coupon()], VESTIGE);

    expect(drop!.bundles).toBe(3);
    expect(drop!.size).toBe(60);
    expect(drop!.seats.map((s) => s.name)).toEqual(["Husky", "Rune", "Bob"]);
    expect(drop!.recorded).toBe(false);
  });

  it("leaves out another drop, and one already gone", () => {
    // Which WEEK is not this function's rule: it takes the rows the panel is already showing, so
    // dropsInWeek narrows them once and the boxes cannot cover a different set.
    const p = party(trio());
    const cases: Loot[] = [
      coupon({ id: "b", dropKey: "grindstone-of-faith" }),
      // Its payouts were pinned from the roster that ran it, so the stacks can no longer move.
      coupon({ id: "c", soldAt: "2026-08-07T00:00:00Z" }),
      coupon({ id: "d", takenByMemberId: "m1" }),
    ];

    expect(assignableDrops(p, cases, VESTIGE)).toEqual([]);
  });

  it("leaves out a night with nothing to hand out", () => {
    const p = party(trio());
    // One stack cannot be shared however anybody agreed.
    expect(assignableDrops(p, [coupon({ bundles: 1 })], VESTIGE)).toEqual([]);

    // And a party that folds to ONE person: three characters, one human, nothing owed to anybody.
    const mine = [seat("m1", "Husky", { mine: true }), seat("m2", "morebuff12", { mine: true })];
    const solo = party(mine);
    expect(assignableDrops(solo, [coupon({ ranThatWeek: ["m1", "m2"] })], VESTIGE)).toEqual([]);
  });

  it("reads an arrangement naming somebody the week no longer has as unsaid", () => {
    // Record the stacks, then drop Bob from the week. His stack cannot be drawn against this
    // roster, and showing the rest would be an arrangement two stacks short calling itself saved.
    const p = party(trio());
    const stale = coupon({
      ranThatWeek: ["m1", "m2"],
      bundlesBy: [
        { memberId: "m1", bundles: 2 },
        { memberId: "m3", bundles: 1 },
      ],
    });

    const [drop] = assignableDrops(p, [stale], VESTIGE);
    expect(drop!.recorded).toBe(false);
    expect(drop!.counts).toEqual({});
  });
});

describe("where the boxes open", () => {
  const drop = (over: Partial<Loot> = {}) =>
    assignableDrops(party(trio()), [coupon(over)], VESTIGE)[0]!;

  it("shows the arrangement recorded, so a wrong one is corrected rather than re-guessed", () => {
    const saved = drop({
      bundlesBy: [
        { memberId: "m1", bundles: 2 },
        { memberId: "m2", bundles: 1 },
      ],
    });

    expect(openingCounts(saved, party(trio()), new Map())).toEqual({ m1: 2, m2: 1 });
  });

  it("opens on the agreed looter holding the lot when nothing is recorded", () => {
    const p = party(trio(), { looterMemberId: "m2" });
    expect(openingCounts(drop(), p, new Map())).toEqual({ m2: 3 });
  });

  it("ignores a looter who sat the week out", () => {
    // Bob loots for this party as a rule, and was not there. Opening on him would suggest three
    // stacks in the hands of somebody who was not in the game. So it falls to the balance instead,
    // which for a duo on three stacks is two and one: there is no even answer, and that is the
    // point of the night being answerable at all.
    const p = party(trio(), { looterMemberId: "m3" });
    const night = drop({ ranThatWeek: ["m1", "m2"] });

    expect(openingCounts(night, p, new Map())).toEqual({ m1: 2, m2: 1 });
  });

  it("otherwise opens balanced, a stack each", () => {
    expect(openingCounts(drop(), party(trio()), new Map())).toEqual({ m1: 1, m2: 1, m3: 1 });
  });
});

describe("what the boxes come to", () => {
  const drop = () => assignableDrops(party(trio()), [coupon()], VESTIGE)[0]!;

  it("sums the stacks placed, which is the only rule the server enforces", () => {
    expect(assignedStacks({ m1: 2, m2: 1, m3: 0 })).toBe(3);
    expect(assignedStacks({ m1: 1, m2: 1 })).toBe(2);
  });

  it("leaves a seat on none out, rather than sending a zero the server refuses", () => {
    expect(stacksToSave({ m1: 2, m2: 1, m3: 0 })).toEqual({ m1: 2, m2: 1 });
  });

  it("says who is holding somebody else's coupons, in pieces", () => {
    // Husky takes two of the three stacks. A third of 180 is 60 each, so he is 60 over and Bob,
    // who bent down for nothing, is 60 short.
    const owed = pieceDrift(drop(), { m1: 2, m2: 1, m3: 0 });

    expect(owed.get("self")).toBe(60);
    expect(owed.get("character:rune")).toBe(0);
    expect(owed.get("character:bob")).toBe(-60);
  });

  it("measures one person's two characters as one holder on two shares", () => {
    // A human who brings two characters is owed twice as much, and is owed it ONCE. So a stack
    // each all round is exactly fair here, even though it is 60 to you and 120 to them.
    const seats = [
      seat("m1", "Husky", { mine: true }),
      seat("m2", "CreedBratton", { person: "p-bro" }),
      seat("m3", "Freeballynn", { person: "p-bro" }),
    ];
    const night = assignableDrops(party(seats), [coupon()], VESTIGE)[0]!;

    const even = pieceDrift(night, { m1: 1, m2: 1, m3: 1 });
    expect(even.get("self")).toBe(0);
    expect(even.get("person:p-bro")).toBe(0);

    // And their two seats net against each other rather than reading as one owed and one owing:
    // three stacks across the pair is 180 held against a 120 entitlement, over by one stack.
    const grabbed = pieceDrift(night, { m1: 0, m2: 2, m3: 1 });
    expect(grabbed.get("self")).toBe(-60);
    expect(grabbed.get("person:p-bro")).toBe(60);
  });

  it("is all zeroes on a night that divided", () => {
    expect([...pieceDrift(drop(), { m1: 1, m2: 1, m3: 1 }).values()]).toEqual([0, 0, 0]);
  });
});
