import { describe, expect, it } from "vitest";
import { runWeeks, weekRuns } from "./week-runs";
import type { Loot, PartyLootPool } from "@/types/loot";
import type { Party, PartyMember } from "@/types/party";

const VESTIGE = "vestige-of-erion";
const JULY = "2026-07-30";
const AUGUST = "2026-08-06";
/** The catalog's own order, which is what the page hands in. */
const BOSSES = new Map([
  ["kalos-the-guardian", 2],
  ["limbo", 6],
]);

const seat = (id: string, name: string, mine = false): PartyMember => ({
  id,
  name,
  personId: null,
  personName: null,
  characterId: mine ? `char-${id}` : null,
  spriteImgUrl: null,
  guest: false,
  shares: 1,
});

const party = (
  id: string,
  bossKey: string,
  seats: PartyMember[],
  over: Partial<Party> = {},
): Party => ({
  id,
  characterId: seats[0]!.characterId!,
  solo: false,
  oneOff: false,
  retired: false,
  worldType: "INTERACTIVE",
  bossKey,
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

const coupon = (
  id: string,
  bossKey: string,
  weekStart: string,
  over: Partial<Loot> = {},
): Loot => ({
  id,
  dropKey: VESTIGE,
  customName: null,
  name: "Vestige of Erion Coupon",
  iconUrl: null,
  perMember: null,
  bossKey,
  quantity: 180,
  droppedOn: weekStart,
  weekStart,
  status: "PENDING",
  saleAmount: null,
  amountBasis: null,
  splitMethod: null,
  sellerShares: null,
  sellerMemberId: null,
  takenByMemberId: null,
  soldAt: null,
  payouts: [],
  ranThatWeek: [],
  bundles: 3,
  bundlesBy: [],
  ...over,
});

const pool = (partyId: string, loot: Loot[]): PartyLootPool => ({ partyId, loot });

/** Your character, on a boss you have never set a party for. One seat, and not a party. */
const alone = (id: string, bossKey: string) =>
  party(id, bossKey, [seat("m1", "Husky", true)], { solo: true });

const ORDER = ["char-m1"];

describe("the weeks the sheet steps through", () => {
  it("names each week once, newest first, and only for this coupon", () => {
    const other = coupon("l3", "limbo", "2026-06-04", { dropKey: "grindstone-of-faith" });
    const pools = [
      pool("pa", [coupon("l1", "limbo", JULY), coupon("l2", "kalos-the-guardian", JULY), other]),
      pool("pb", [coupon("l4", "limbo", AUGUST)]),
    ];

    expect(runWeeks(pools, VESTIGE)).toEqual([AUGUST, JULY]);
  });
});

describe("one week's nights", () => {
  it("leaves out the weeks either side of the one asked for", () => {
    const p = alone("pa", "limbo");
    const pools = [pool("pa", [coupon("l1", "limbo", JULY), coupon("l2", "limbo", AUGUST)])];

    expect(weekRuns([p], pools, VESTIGE, JULY, ORDER, BOSSES).map((r) => r.lootId)).toEqual(["l1"]);
  });

  it("names nobody on a boss run alone, which is a row to fill in rather than one to correct", () => {
    // The state every Grandis boss starts in for somebody who keeps no set parties: the clear filed
    // 180 coupons into a pool that is not a party and has nobody to divide them with.
    const runs = weekRuns(
      [alone("pa", "limbo")],
      [pool("pa", [coupon("l1", "limbo", JULY)])],
      VESTIGE,
      JULY,
      ORDER,
      BOSSES,
    );

    expect(runs[0]!.others).toEqual([]);
    expect(runs[0]!.quantity).toBe(180);
    expect(runs[0]!.bundles).toBe(3);
  });

  it("draws the names from the drop's own week, not from the party today", () => {
    // The whole point of the sheet. This week Husky ran with Cara; the night being filled in was
    // with Steve, and drawing the party's roster over it would put the wrong name in the box.
    const seats = [seat("m1", "Husky", true), seat("m2", "Steve"), seat("m3", "Cara")];
    const p = party("pa", "limbo", seats, { members: [seats[0]!, seats[2]!] });
    const july = coupon("l1", "limbo", JULY, { ranThatWeek: ["m1", "m2"] });

    const runs = weekRuns([p], [pool("pa", [july])], VESTIGE, JULY, ORDER, BOSSES);

    expect(runs[0]!.others).toEqual(["Steve"]);
  });

  it("says what has already happened to a drop, because that week can no longer be answered", () => {
    const p = alone("pa", "limbo");
    const sold = coupon("l1", "limbo", JULY, { soldAt: "2026-08-01T00:00:00Z" });
    const taken = coupon("l2", "kalos-the-guardian", JULY, { takenByMemberId: "m1" });
    const runs = weekRuns([p], [pool("pa", [sold, taken])], VESTIGE, JULY, ORDER, BOSSES);

    // Kalos before Limbo, as the catalog has them.
    expect(runs.map((r) => [r.lootId, r.locked])).toEqual([
      ["l2", "taken"],
      ["l1", "sold"],
    ]);

    const open = weekRuns(
      [p],
      [pool("pa", [coupon("l3", "limbo", JULY)])],
      VESTIGE,
      JULY,
      ORDER,
      BOSSES,
    );
    expect(open[0]!.locked).toBeNull();
  });

  it("orders by the roster and then by the catalog, so nothing swaps places between reloads", () => {
    const first = party("pa", "limbo", [seat("m1", "Husky", true)]);
    const second = party("pb", "kalos-the-guardian", [seat("m2", "Bebe", true)]);
    const third = party("pc", "kalos-the-guardian", [seat("m1", "Husky", true)]);
    const pools = [
      pool("pa", [coupon("l1", "limbo", JULY)]),
      pool("pb", [coupon("l2", "kalos-the-guardian", JULY)]),
      pool("pc", [coupon("l3", "kalos-the-guardian", JULY)]),
    ];

    const runs = weekRuns(
      [first, second, third],
      pools,
      VESTIGE,
      JULY,
      ["char-m1", "char-m2"],
      BOSSES,
    );

    // Husky's two first, Kalos before Limbo as the catalog has them, then the other character.
    expect(runs.map((r) => r.lootId)).toEqual(["l3", "l1", "l2"]);
  });

  it("leaves out a drop with no boss, which has no pair to make a party from", () => {
    const p = alone("pa", "limbo");
    const loose = coupon("l1", "limbo", JULY, { bossKey: null });

    expect(weekRuns([p], [pool("pa", [loose])], VESTIGE, JULY, ORDER, BOSSES)).toEqual([]);
  });
});
