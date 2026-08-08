import { describe, expect, it } from "vitest";
import {
  type Holder,
  holderKey,
  holderLedgers,
  holderOf,
  ledgerForLoot,
  outstanding,
  salesByHolder,
  unsold,
} from "./vestige-ledger";
import type { Loot, PartyLootPool } from "@/types/loot";
import type { Party, PartyMember } from "@/types/party";

const M = 1_000_000;
const VESTIGE = "vestige-of-erion";
const ORDER = new Map([
  ["limbo", 6],
  ["baldrix", 7],
  ["kalos-the-guardian", 2],
]);

/**
 * A seat. `mine` makes it one of YOUR characters, `person` somebody on the people list.
 *
 * The three kinds of seat are the whole point of this file: your own fold into one holder, one
 * person's characters fold into one holder, and a character nobody has claimed stands alone.
 */
const seat = (
  id: string,
  name: string,
  { mine = false, person = null as [string, string] | null } = {},
): PartyMember => ({
  id,
  name,
  personId: person?.[0] ?? null,
  personName: person?.[1] ?? null,
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

const SELF: Holder = { kind: "SELF", personId: null, characterName: null };
const BRO: Holder = { kind: "PERSON", personId: "p-bro", characterName: null };

/** Your character loots for a trio with two strangers. */
const trio = () => [seat("m1", "Husky", { mine: true }), seat("m2", "Rune"), seat("m3", "Bob")];

describe("who a seat belongs to", () => {
  it("is the person when somebody plays them, you when they are yours, the name otherwise", () => {
    expect(holderOf(seat("m1", "CreedBratton", { person: ["p-bro", "Bro"] }))).toEqual(BRO);
    expect(holderOf(seat("m2", "Husky", { mine: true }))).toEqual(SELF);
    expect(holderOf(seat("m3", "Stranger"))).toEqual({
      kind: "CHARACTER",
      personId: null,
      characterName: "stranger",
    });
  });

  it("folds one key per holder, so a name spelled two ways is one pile", () => {
    expect(holderKey(holderOf(seat("m1", "Rune")))).toBe(holderKey(holderOf(seat("m2", "rune"))));
    // Two of one person's characters, and two of yours, are each one key.
    expect(holderKey(holderOf(seat("m1", "CreedBratton", { person: ["p-bro", "Bro"] })))).toBe(
      holderKey(holderOf(seat("m2", "Freeballynn", { person: ["p-bro", "Bro"] }))),
    );
    expect(holderKey(holderOf(seat("m3", "Husky", { mine: true })))).toBe(
      holderKey(holderOf(seat("m4", "morebuff12", { mine: true }))),
    );
  });
});

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
    expect(drops[0]!.holder).toEqual(SELF);
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

  it("leaves out a night that is all one person, however many characters they brought", () => {
    // Two of your own characters. Somebody looted the lot, and it is already where it belongs:
    // you cannot owe yourself, and a debt on this row would be a figure nobody should act on.
    const mine = party(
      "pa",
      "limbo",
      [seat("m1", "Husky", { mine: true }), seat("m2", "morebuff12", { mine: true })],
      "m1",
    );
    expect(
      outstanding([mine], [pool("pa", [coupon("l1", "limbo", 60, "2026-07-30")])], VESTIGE, ORDER),
    ).toEqual([]);

    // Same for a duo that is one other person's two characters.
    const theirs = party(
      "pb",
      "limbo",
      [
        seat("m3", "CreedBratton", { person: ["p-bro", "Bro"] }),
        seat("m4", "Freeballynn", { person: ["p-bro", "Bro"] }),
      ],
      "m3",
    );
    expect(
      outstanding(
        [theirs],
        [pool("pb", [coupon("l2", "limbo", 60, "2026-07-30")])],
        VESTIGE,
        ORDER,
      ),
    ).toEqual([]);
  });

  it("leaves out other drops, and a party of one", () => {
    const p = party("pa", "limbo", trio(), "m1");
    const other: Loot = {
      ...coupon("l2", "limbo", 1, "2026-07-30"),
      dropKey: "grindstone-of-faith",
    };
    expect(outstanding([p], [pool("pa", [other])], VESTIGE, ORDER)).toEqual([]);

    const alone = party("pb", "limbo", [seat("m9", "Husky", { mine: true })], "m9");
    expect(
      outstanding([alone], [pool("pb", [coupon("l3", "limbo", 60, "2026-07-30")])], VESTIGE, ORDER),
    ).toEqual([]);
  });
});

describe("a debt is between people, not between characters", () => {
  it("nets two of your characters into one seat, so you are owed once", () => {
    // Husky loots 60 for a trio of you, your alt, and Jared. Two thirds of it is already yours.
    const p = party(
      "pa",
      "limbo",
      [
        seat("m1", "Husky", { mine: true }),
        seat("m2", "morebuff12", { mine: true }),
        seat("m3", "CourseLair", { person: ["p-jared", "Jared"] }),
      ],
      "m1",
    );
    const ledgers = holderLedgers(
      outstanding([p], [pool("pa", [coupon("l1", "limbo", 60, "2026-07-30")])], VESTIGE, ORDER),
      salesByHolder([{ holder: SELF, pieces: 60, amount: 600 * M }]),
    );

    const limbo = ledgers[0]!.drops[0]!;
    // One debt, to Jared, for a third. Keyed by character this said "owes morebuff12 20" as well,
    // which is you paying yourself.
    expect(limbo.transfers.map((t) => [t.to, t.pieces])).toEqual([["Jared", 20]]);
  });

  it("counts one person's two seats as two shares, and pays them once", () => {
    // Bro brought two characters, so he is entitled to two thirds of the drop, in one transfer.
    const p = party(
      "pa",
      "limbo",
      [
        seat("m1", "Husky", { mine: true }),
        seat("m2", "CreedBratton", { person: ["p-bro", "Bro"] }),
        seat("m3", "Freeballynn", { person: ["p-bro", "Bro"] }),
      ],
      "m1",
    );
    const ledgers = holderLedgers(
      outstanding([p], [pool("pa", [coupon("l1", "limbo", 60, "2026-07-30")])], VESTIGE, ORDER),
      new Map(),
    );
    expect(ledgers[0]!.drops[0]!.transfers.map((t) => [t.to, t.pieces])).toEqual([["Bro", 40]]);
  });
});

describe("one card per holder, distributing one input", () => {
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
    const ledgers = holderLedgers(
      drops,
      salesByHolder([{ holder: SELF, pieces: 60, amount: 1_450 * M }]),
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
    const ledgers = holderLedgers(
      outstanding(parties, pools, VESTIGE, ORDER),
      salesByHolder([
        { holder: SELF, pieces: 50, amount: 1_200 * M },
        { holder: SELF, pieces: 10, amount: 250 * M },
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

  it("pools one person's characters into one pile and one queue", () => {
    // Bro loots Limbo on one character and Baldrix on another. One human, one box, one queue: the
    // sale he reports is not per inventory, and asking him which character it came from is the
    // bookkeeping this removes.
    const creed = seat("m1", "CreedBratton", { person: ["p-bro", "Bro"] });
    const free = seat("m4", "Freeballynn", { person: ["p-bro", "Bro"] });
    const you = seat("m2", "Husky", { mine: true });
    const drops = outstanding(
      [party("pa", "limbo", [creed, you], "m1"), party("pb", "baldrix", [free, you], "m4")],
      [
        pool("pa", [coupon("l1", "limbo", 60, "2026-07-30")]),
        pool("pb", [coupon("l2", "baldrix", 120, "2026-08-06")]),
      ],
      VESTIGE,
      ORDER,
    );
    const ledgers = holderLedgers(
      drops,
      salesByHolder([{ holder: BRO, pieces: 60, amount: 1_450 * M }]),
    );

    expect(ledgers).toHaveLength(1);
    expect(ledgers[0]!.holderName).toBe("Bro");
    expect(ledgers[0]!.pieces).toBe(180);
    // The row still says which of his characters looted it, which the fold would otherwise lose.
    expect(ledgers[0]!.drops.map((d) => d.looterName)).toEqual(["CreedBratton", "Freeballynn"]);
    // His one sale covered the oldest boss, whichever character it was looted on.
    expect(ledgers[0]!.drops[0]!.complete).toBe(true);
    expect(ledgers[0]!.drops[1]!.covered).toBe(0);
  });

  it("shows the pieces owed but no money until that boss is covered", () => {
    const { parties, pools } = setup();
    const ledgers = holderLedgers(outstanding(parties, pools, VESTIGE, ORDER), new Map());
    const limbo = ledgers[0]!.drops[0]!;
    expect(limbo.transfers[0]!.pieces).toBe(20);
    expect(limbo.transfers[0]!.send).toBeNull();
  });

  it("keeps two holders' piles apart, because one cannot spend the other's", () => {
    const mine = party("pa", "limbo", trio(), "m1");
    const theirs = party(
      "pb",
      "baldrix",
      [
        seat("m4", "CreedBratton", { person: ["p-bro", "Bro"] }),
        seat("m5", "Husky", { mine: true }),
      ],
      "m4",
    );
    const drops = outstanding(
      [mine, theirs],
      [
        pool("pa", [coupon("l1", "limbo", 60, "2026-07-30")]),
        pool("pb", [coupon("l2", "baldrix", 120, "2026-07-30")]),
      ],
      VESTIGE,
      ORDER,
    );
    const ledgers = holderLedgers(
      drops,
      salesByHolder([{ holder: SELF, pieces: 60, amount: 600 * M }]),
    );

    expect(ledgers.map((l) => l.holderName)).toEqual(["Bro", "you"]);
    // Your sale covered your boss and did not touch Bro's pile.
    expect(ledgers[0]!.drops[0]!.covered).toBe(0);
    expect(ledgers[1]!.drops[0]!.complete).toBe(true);
  });

  it("finds one loot row's line, for the row's own read-only display", () => {
    const { parties, pools } = setup();
    const ledgers = holderLedgers(
      outstanding(parties, pools, VESTIGE, ORDER),
      salesByHolder([{ holder: SELF, pieces: 60, amount: 1_450 * M }]),
    );
    const found = ledgerForLoot(ledgers, "l1")!;
    expect(found.holderName).toBe("you");
    expect(found.drop.complete).toBe(true);
    expect(ledgerForLoot(ledgers, "nope")).toBeNull();
  });
});

describe("a sale is entered as a total, never a price each", () => {
  it("derives the per-piece figure so nobody divides by hand", () => {
    // What a partner reports is "1.2b for the 50", which is what the box takes.
    const [sale] = salesByHolder([{ holder: SELF, pieces: 50, amount: 1_200 * M }]).get(
      holderKey(SELF),
    )!;
    expect(sale!.priceEach).toBe(24 * M);
  });
});
