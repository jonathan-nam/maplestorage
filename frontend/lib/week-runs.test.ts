import { describe, expect, it } from "vitest";
import {
  countKey,
  recordedArrangement,
  runWeeks,
  stacksBySeat,
  suggestedArrangement,
  weekRuns,
  type WeekRun,
} from "./week-runs";
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
    const pools = [pool("pa", [loose])];

    expect(weekRuns([p], pools, VESTIGE, JULY, ORDER, BOSSES)).toEqual([]);
    // And the week it fell in is not offered either. Offered and then empty, the reader lands on a
    // card with nothing on it and no way to tell that from a bug.
    expect(runWeeks(pools, VESTIGE)).toEqual([]);
  });
});

describe("what a row says about its stacks", () => {
  const three = () => [seat("m1", "Husky", true), seat("m2", "Rune"), seat("m3", "Bob")];

  const night = (over: Partial<Loot> = {}, partyOver: Partial<Party> = {}) => {
    const p = party("pa", "limbo", three(), partyOver);
    const loot = coupon("l1", "limbo", JULY, {
      bundles: 3,
      ranThatWeek: ["m1", "m2", "m3"],
      ...over,
    });
    return weekRuns([p], [pool("pa", [loot])], VESTIGE, JULY, ORDER, BOSSES)[0]!;
  };

  it("counts PEOPLE, so one person's two characters are not a night that divides", () => {
    // Nothing to allocate: both stacks are already theirs however they were picked up. Counted as
    // seats this would read as a duo and offer chips over a debt that cannot exist.
    const mine = [seat("m1", "Husky", true), seat("m2", "morebuff12", true)];
    const p = party("pa", "limbo", mine);
    const loot = coupon("l1", "limbo", JULY, { bundles: 2, ranThatWeek: ["m1", "m2"] });
    const run = weekRuns([p], [pool("pa", [loot])], VESTIGE, JULY, ORDER, BOSSES)[0]!;

    expect(run.seats).toHaveLength(2);
    expect(run.holders).toBe(1);
  });

  it("keeps 'nobody has said' apart from an arrangement that was entered", () => {
    // What the chips open on turns on this. Empty read as an arrangement would look answered, and
    // the night would never be offered the looter it actually had.
    expect(night().recorded).toBeNull();
    expect(night({ bundlesBy: [{ memberId: "m1", bundles: 3 }] }).recorded).toEqual({ m1: 3 });
  });

  it("ignores a looter who sat the week out", () => {
    // Bob loots for this party as a rule, and was not there. Opening the chips on him would put
    // three stacks in the hands of somebody who was not in the game.
    expect(
      night({ ranThatWeek: ["m1", "m2"] }, { looterMemberId: "m3" }).looterMemberId,
    ).toBeNull();
    expect(night({}, { looterMemberId: "m3" }).looterMemberId).toBe("m3");
  });
});

describe("where the chips open", () => {
  const seats = [seat("m1", "Husky", true), seat("m2", "Rune"), seat("m3", "Bob")];
  const run = (over: Partial<WeekRun> = {}): WeekRun => ({
    lootId: "l1",
    partyId: "pa",
    characterId: "char-m1",
    bossKey: "limbo",
    weekStart: JULY,
    quantity: 180,
    bundles: 3,
    seats,
    others: ["Rune", "Bob"],
    locked: null,
    holders: 3,
    recorded: null,
    looterMemberId: null,
    ...over,
  });

  it("shows the arrangement already recorded, so a wrong one can be corrected", () => {
    // The gap this card exists to close: a night answered once had no control at all, so an
    // arrangement entered wrongly was permanent.
    expect(recordedArrangement(run({ recorded: { m1: 2, m2: 1 } }))).toEqual(["m1", "m1", "m2"]);
  });

  it("reads an arrangement naming somebody the week no longer has as unsaid", () => {
    // Record the stacks, then edit the week's roster to drop Bob. His stack cannot be drawn against
    // this roster, and padding it out would hand it to somebody who did not take it.
    const stale = run({ recorded: { m1: 2, m3: 1 }, seats: seats.slice(0, 2) });
    expect(recordedArrangement(stale)).toBeNull();
  });

  it("opens on the agreed looter holding the lot, when nothing is recorded", () => {
    expect(suggestedArrangement(run({ looterMemberId: "m2" }), new Map())).toEqual([
      "m2",
      "m2",
      "m2",
    ]);
  });

  it("otherwise opens balanced, a stack each", () => {
    expect(suggestedArrangement(run(), new Map())).toEqual(["m1", "m2", "m3"]);
  });

  it("compares two arrangements by seat, not by the order the chips sit in", () => {
    // Cycling a chip and putting it back must not leave Save lit. Compared as objects this turned
    // on key insertion order, which cycling changes.
    expect(countKey(["m1", "m2", "m1"])).toBe(countKey(["m1", "m1", "m2"]));
    expect(countKey(["m1", "m2", "m1"])).not.toBe(countKey(["m1", "m2", "m2"]));
  });

  it("leaves a seat with no stacks out, rather than sending a zero the server refuses", () => {
    expect(Object.fromEntries(stacksBySeat(["m1", "m1", "m2"]))).toEqual({ m1: 2, m2: 1 });
  });
});
