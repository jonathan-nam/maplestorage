import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { behindByHolder, rotationFor } from "./loot-rotation";
import { assignableDrops, openingCounts, pickupStated } from "./vestige-pickup";
import type { BossDrop } from "@/types/drop";
import type { Loot } from "@/types/loot";
import type { Party, PartyMember } from "@/types/party";

// A rotation reads the arrangements already recorded, and nothing ever recorded one. The pickup
// boxes only asked for the coupon, the Drop Ledger leaves pieces out of the log entirely, and the
// server was the only part of the path that never cared which drop it was handed.
//
// So every rotation on the account was built from ZERO answered weeks, every holder sat on a
// balance of nought, and suggestArrangement broke the tie the only way left: by seat index. Hard
// Kaling told the same person to take 4 of the 7 every week from the day it shipped.
//
// The reader was right the whole time, which is why nothing here tests the arithmetic again. What
// these pin is that the write exists and reaches it.

const seat = (id: string, name: string, { mine = false } = {}): PartyMember => ({
  id,
  name,
  personId: null,
  personName: null,
  // Only YOUR seats carry one, and every seat that does folds into the same holder. Both seats
  // holding a character id would make this duo one person, which rotates nothing.
  characterId: mine ? `char-${id}` : null,
  linkedCharacterId: null,
  spriteImgUrl: null,
  guest: false,
  shares: 1,
});

const RING = "ferocious-beast-ring";
const WEEK = "2026-08-27";

/** Hard Kaling on Interactive: seven rings, one to a stack, pooled and untradeable. */
const ring: BossDrop = {
  dropKey: RING,
  name: "Ferocious Beast Ring",
  iconUrl: null,
  perMember: "HEROIC",
  worlds: null,
  quantity: 1,
  fungible: false,
  untradeable: true,
  pieces: { INTERACTIVE: { HARD: 7 }, HEROIC: { HARD: 2 } },
  bundles: { INTERACTIVE: { HARD: 7 }, HEROIC: { HARD: 2 } },
};

const acorn = seat("m1", "acornacorn", { mine: true });
const iphone = seat("m2", "iPhone69C");

const party = (over: Partial<Party> = {}): Party => ({
  id: "pa",
  slug: "acornacorn/kaling",
  characterId: "char-m1",
  solo: false,
  oneOff: false,
  retired: false,
  worldType: "INTERACTIVE",
  bossKey: "kaling",
  difficulty: "HARD",
  minutes: null,
  looterMemberId: null,
  members: [acorn, iphone],
  seats: [acorn, iphone],
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

const night = (id: string, week: string, by: Record<string, number>): Loot => ({
  id,
  dropKey: RING,
  customName: null,
  name: "Ferocious Beast Ring",
  iconUrl: null,
  perMember: "HEROIC",
  bossKey: "kaling",
  quantity: 7,
  difficulty: null,
  droppedOn: week,
  weekStart: week,
  status: "PENDING",
  saleAmount: null,
  amountBasis: null,
  splitMethod: null,
  sellerShares: null,
  sellerMemberId: null,
  takenByMemberId: null,
  soldAt: null,
  payouts: [],
  ranThatWeek: ["m1", "m2"],
  bundles: 7,
  bundlesBy: Object.entries(by).map(([memberId, bundles]) => ({ memberId, bundles })),
});

/** The piece, as the pickup boxes ask for a drop, against a balance of nothing recorded yet. */
const asPiece = (behind: Map<string, number> = new Map()) => ({
  dropKey: RING,
  tradeable: false,
  behind,
});

describe("a piece night can be answered", () => {
  it("offers the night, marked as one nothing can settle", () => {
    const [drop] = assignableDrops(party(), [night("l1", WEEK, {})], asPiece());

    expect(drop!.bundles).toBe(7);
    expect(drop!.size).toBe(1);
    expect(drop!.recorded).toBe(false);
    // The whole difference from a coupon night. A shortfall here is a turn to loot, so nothing on
    // screen may state it as something somebody owes.
    expect(drop!.tradeable).toBe(false);
  });

  it("reads an answered night back, so a wrong one is corrected rather than added to", () => {
    const [drop] = assignableDrops(party(), [night("l1", WEEK, { m1: 4, m2: 3 })], asPiece());

    expect(drop!.recorded).toBe(true);
    expect(openingCounts(drop!, party())).toEqual({ m1: 4, m2: 3 });
  });

  it("keeps a night of ONE piece, which a coupon night of one stack is not", () => {
    // Easy Kaling drops a single fragment. One stack of coupons cannot be shared, so that night is
    // left out, but one ring is a whole turn and whose it was is the only thing that rotates it.
    const one = [{ ...night("l1", WEEK, {}), quantity: 1, bundles: 1 }];

    expect(assignableDrops(party(), one, asPiece())).toHaveLength(1);
    expect(
      assignableDrops(party(), one, { dropKey: RING, tradeable: true, behind: new Map() }),
    ).toHaveLength(0);
  });

  it("says nothing at rest about a night nobody has answered", () => {
    // A coupon night still has "60 due" to state. Seven rings between two people is 3.5 each, which
    // is not a figure anybody can be handed or be short of, and the turn is the rotation's to say.
    const [unsaid] = assignableDrops(party(), [night("l1", WEEK, {})], asPiece());
    const [said] = assignableDrops(party(), [night("l2", WEEK, { m1: 4, m2: 3 })], asPiece());

    expect(pickupStated(unsaid!)).toBe(false);
    expect(pickupStated(said!)).toBe(true);
  });
});

describe("the answer turns the rotation", () => {
  const rotate = (loot: Loot[]) => rotationFor(party(), loot, ring, 7, 7)!;

  it("breaks the tie by seat order until a week is answered, which is what shipped", () => {
    const cold = rotate([]);

    expect(cold.weeks).toBe(0);
    // Not a turn: nobody is behind, so the spare stack falls to seat 0 and stays there for ever.
    expect(cold.holders.map((h) => h.takes)).toEqual([4, 3]);
    expect(cold.holders.map((h) => h.behind)).toEqual([0, 0]);
  });

  it("turns the week after one is recorded", () => {
    const turned = rotate([night("l1", "2026-08-20", { m1: 4, m2: 3 })]);

    expect(turned.weeks).toBe(1);
    // Half a ring each way against a share of 3.5, which is exactly what has to survive the week.
    expect(turned.holders.map((h) => h.behind)).toEqual([-0.5, 0.5]);
    // Your own seat folds to "you", which is how every screen names it.
    expect(turned.holders.map((h) => h.name)).toEqual(["you", "iPhone69C"]);
    expect(turned.holders.map((h) => h.takes)).toEqual([3, 4]);
  });

  it("opens the next night's boxes on the same turn the rotation drew", () => {
    // The two are one reckoning, not two that agree until one of them changes. `behind` rides on
    // the night for that reason: a panel listing coupon nights beside piece nights would otherwise
    // open one of them against the other's map.
    const turned = rotate([night("l1", "2026-08-20", { m1: 4, m2: 3 })]);
    const [next] = assignableDrops(
      party(),
      [night("l2", WEEK, {})],
      asPiece(behindByHolder(turned)),
    );

    expect(openingCounts(next!, party())).toEqual({ m1: 3, m2: 4 });
  });
});

describe("the write is wired to every screen that draws a rotation", () => {
  const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const parties = read("app/bosses/parties/page.tsx");
  const pool = read("app/bosses/parties/[...slug]/page.tsx");
  const list = read("components/loot-list.tsx");

  it("asks for the rotating drop by name, not for the coupon", () => {
    // The bug in one line: every call site passed VESTIGE, so a piece night was never on the list.
    for (const page of [parties, pool]) {
      expect(page).toContain("tradeable: false");
      expect(page).toContain("behind: behindByHolder(rotation)");
    }
  });

  it("does not hang the piece off the coupon's block", () => {
    // shareConfig returns null on a mode that drops no coupon, and half the modes that rotate a
    // piece are exactly that: Chaos Kalos, Normal Kaling, Normal Malefic Star, Normal Adversary.
    const built = parties.slice(
      parties.indexOf("const piecePickupFor"),
      parties.indexOf("const poolFor"),
    );
    expect(built.length).toBeGreaterThan(0);
    expect(built).not.toContain("shareConfig");
    expect(built).not.toContain("stacksFor");
    expect(built).toContain("/bundles");
  });

  it('stops saying "this week" once this week has been answered', () => {
    // The balance counts every answered week, tonight's included, so recording the night moves the
    // rotation on the spot. Left alone, the block would tell you to undo what you just entered.
    const rotationBlock = read("components/loot-rotation.tsx");
    expect(rotationBlock).toContain('answered ? "next week" : "this week"');
    expect(list).toContain("piecePickup?.drops.every((d) => d.recorded)");
  });

  it("draws the boxes for a night from either block, never one against the other's balance", () => {
    // The title, the write and the balance travel together. Reaching for `stacks.pickup` while
    // drawing a piece night is the mix-up this shape makes unwritable.
    expect(list).toContain("nightIn(item.id, stacks?.pickup) ?? nightIn(item.id, piecePickup)");
    expect(list).toContain("found.pickup.onSave");
    expect(list).not.toContain("stacks.pickup.behind");
  });
});
