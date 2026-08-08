import { describe, expect, it } from "vitest";
import { ledgerForLoot, looterLedgers, outstanding, salesByLooter, unsold } from "./vestige-ledger";
import type { Loot, PartyLootPool } from "@/types/loot";
import type { Party, PartyMember } from "@/types/party";

const M = 1_000_000;
const VESTIGE = "vestige-of-erion";
const ORDER = new Map([
  ["limbo", 6],
  ["baldrix", 7],
  ["kalos-the-guardian", 2],
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
  members: PartyMember[],
  looter: string | null,
): Party => ({
  id,
  characterId: members[0]!.characterId ?? `char-${members[0]!.id}`,
  solo: false,
  oneOff: false,
  retired: false,
  worldType: "INTERACTIVE",
  bossKey,
  difficulty: "HARD",
  minutes: null,
  looterMemberId: looter,
  members,
  seats: members,
  usualRoster: true,
  skippedThisPeriod: false,
  pendingLoot: 0,
  awaitingPayout: 0,
  settledLoot: 0,
  cleared: null,
  clearedByHand: false,
  createdAt: "2026-07-01T00:00:00Z",
  updatedAt: "2026-07-01T00:00:00Z",
});

const coupon = (id: string, bossKey: string, quantity: number, weekStart: string): Loot => ({
  id,
  dropKey: VESTIGE,
  customName: null,
  name: "Vestige of Erion Coupon",
  iconUrl: null,
  perMember: null,
  bossKey,
  quantity,
  droppedOn: weekStart,
  weekStart,
  status: "PENDING",
  saleAmount: null,
  amountBasis: null,
  splitMethod: null,
  sellerShares: null,
  sellerMemberId: null,
  soldAt: null,
  payouts: [],
  ranThatWeek: [],
});

const pool = (partyId: string, loot: Loot[]): PartyLootPool => ({ partyId, loot });

/** Husky's trio, where the partner loots everything. */
const trio = () => [seat("m1", "Husky", true), seat("m2", "Rune"), seat("m3", "Bob")];

describe("which drops are outstanding", () => {
  it("takes a drop whose party names a looter", () => {
    const p = party("pa", "limbo", trio(), "m1");
    const drops = outstanding(
      [p],
      [pool("pa", [coupon("l1", "limbo", 60, "2026-07-30")])],
      VESTIGE,
      ORDER,
    );
    expect(drops).toHaveLength(1);
    expect(drops[0]!.looterName).toBe("Husky");
    // The looter holds the lot; the others hold none and are owed their share.
    expect(drops[0]!.drop.seats.map((s) => s.looted)).toEqual([60, 0, 0]);
  });

  it("leaves out a party where everybody loots their own", () => {
    // The clear recorded this character's SHARE, nothing is owed, and the even night never appears.
    const p = party("pa", "limbo", trio(), null);
    expect(
      outstanding([p], [pool("pa", [coupon("l1", "limbo", 20, "2026-08-06")])], VESTIGE, ORDER),
    ).toEqual([]);
  });

  it("leaves out other drops, and a party of one", () => {
    const p = party("pa", "limbo", trio(), "m1");
    const other: Loot = {
      ...coupon("l2", "limbo", 1, "2026-07-30"),
      dropKey: "grindstone-of-faith",
    };
    expect(outstanding([p], [pool("pa", [other])], VESTIGE, ORDER)).toEqual([]);

    const alone = party("pb", "limbo", [seat("m9", "Husky", true)], "m9");
    expect(
      outstanding([alone], [pool("pb", [coupon("l3", "limbo", 60, "2026-07-30")])], VESTIGE, ORDER),
    ).toEqual([]);
  });
});

describe("one card per looter, distributing one input", () => {
  const setup = () => {
    const limbo = party("pa", "limbo", trio(), "m1");
    const baldrix = party("pb", "baldrix", trio(), "m1");
    return {
      parties: [limbo, baldrix],
      pools: [
        pool("pa", [coupon("l1", "limbo", 60, "2026-07-30")]),
        pool("pb", [coupon("l2", "baldrix", 120, "2026-08-06")]),
      ],
    };
  };

  it("spends one sale on the oldest boss first, naming no boss at all", () => {
    const { parties, pools } = setup();
    const drops = outstanding(parties, pools, VESTIGE, ORDER);
    const ledgers = looterLedgers(
      drops,
      salesByLooter([{ looterName: "Husky", pieces: 60, amount: 1_450 * M }]),
    );

    expect(ledgers).toHaveLength(1);
    const [limbo, baldrix] = ledgers[0]!.drops;
    expect(limbo!.bossKey).toBe("limbo");
    expect(limbo!.complete).toBe(true);
    expect(baldrix!.covered).toBe(0);
    expect(ledgers[0]!.pieces).toBe(180);
    expect(unsold(ledgers[0]!)).toBe(120);
  });

  it("prices each boss from the sales that covered it, and owes both others", () => {
    const { parties, pools } = setup();
    const ledgers = looterLedgers(
      outstanding(parties, pools, VESTIGE, ORDER),
      salesByLooter([
        { looterName: "Husky", pieces: 50, amount: 1_200 * M },
        { looterName: "Husky", pieces: 10, amount: 250 * M },
      ]),
    );
    const limbo = ledgers[0]!.drops[0]!;
    // 1.45b over 60 pieces, and each of the two others is owed 20 of them.
    expect(limbo.averagePrice).toBeCloseTo(24_166_666.67, 1);
    expect(limbo.transfers.map((t) => [t.to, t.pieces, t.send])).toEqual([
      ["Rune", 20, 483_333_334],
      ["Bob", 20, 483_333_334],
    ]);
  });

  it("shows the pieces owed but no money until that boss is covered", () => {
    const { parties, pools } = setup();
    const ledgers = looterLedgers(outstanding(parties, pools, VESTIGE, ORDER), new Map());
    const limbo = ledgers[0]!.drops[0]!;
    expect(limbo.transfers[0]!.pieces).toBe(20);
    expect(limbo.transfers[0]!.send).toBeNull();
  });

  it("keeps two looters' piles apart, because pieces cannot leave an inventory", () => {
    const mine = party("pa", "limbo", trio(), "m1");
    const theirs = party("pb", "baldrix", [seat("m4", "Rune", true), seat("m5", "Ana")], "m4");
    const drops = outstanding(
      [mine, theirs],
      [
        pool("pa", [coupon("l1", "limbo", 60, "2026-07-30")]),
        pool("pb", [coupon("l2", "baldrix", 120, "2026-07-30")]),
      ],
      VESTIGE,
      ORDER,
    );
    const ledgers = looterLedgers(
      drops,
      salesByLooter([{ looterName: "Husky", pieces: 60, amount: 600 * M }]),
    );

    expect(ledgers.map((l) => l.looterName)).toEqual(["Husky", "Rune"]);
    // Husky's sale covered Husky's boss and did not touch Rune's pile.
    expect(ledgers[0]!.drops[0]!.complete).toBe(true);
    expect(ledgers[1]!.drops[0]!.covered).toBe(0);
  });

  it("finds one loot row's line, for the row's own read-only display", () => {
    const { parties, pools } = setup();
    const ledgers = looterLedgers(
      outstanding(parties, pools, VESTIGE, ORDER),
      salesByLooter([{ looterName: "Husky", pieces: 60, amount: 1_450 * M }]),
    );
    const found = ledgerForLoot(ledgers, "l1")!;
    expect(found.looterName).toBe("Husky");
    expect(found.drop.complete).toBe(true);
    expect(ledgerForLoot(ledgers, "nope")).toBeNull();
  });
});

describe("a sale is entered as a total, never a price each", () => {
  it("derives the per-piece figure so nobody divides by hand", () => {
    // What a partner reports is "1.2b for the 50", which is what the box takes.
    const [sale] = salesByLooter([{ looterName: "Husky", pieces: 50, amount: 1_200 * M }]).get(
      "Husky",
    )!;
    expect(sale!.priceEach).toBe(24 * M);
  });
});
