import { describe, expect, it } from "vitest";
import {
  type Holder,
  holderKey,
  holderLedgers,
  holderOf,
  ledgerForLoot,
  outstanding,
  runningBalance,
  salesByHolder,
  suggestArrangement,
  unanswered,
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

const coupon = (
  id: string,
  bossKey: string,
  quantity: number,
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
  bundles: null,
  bundlesBy: [],
  ...over,
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
    const found = ledgerForLoot(ledgers, "l1");
    expect(found).toHaveLength(1);
    expect(found[0]!.holderName).toBe("you");
    expect(found[0]!.drop.complete).toBe(true);
    expect(ledgerForLoot(ledgers, "nope")).toEqual([]);
  });
});

/**
 * The night that used to vanish.
 *
 * Hard Baldrix is 120 coupons in 3 stacks of 40, and a duo cannot split 3 stacks. outstanding()
 * skipped every party with no looter named, so this filed a row and recorded no debt at all,
 * silently, which is the failure this repo exists to prevent.
 */
describe("uneven self-looting", () => {
  const me = seat("m1", "Husky", { mine: true });
  const them = seat("m2", "Nova", { person: ["p-nova", "Nova"] });
  const NOVA: Holder = { kind: "PERSON", personId: "p-nova", characterName: null };
  const duo = [party("pt", "baldrix", [me, them], null)];
  const split = [
    { memberId: "m1", bundles: 2 },
    { memberId: "m2", bundles: 1 },
  ];

  const baldrix = (over: Partial<Loot> = {}) => [
    pool("pt", [coupon("l1", "baldrix", 120, "2026-08-06", { bundles: 3, ...over })]),
  ];

  it("says a drop that cannot divide is unanswered, and how big the hole is", () => {
    const open = unanswered(duo, baldrix(), VESTIGE);
    expect(open).toHaveLength(1);
    // 3 stacks between 2 people is 2 and 1, so somebody holds half a stack that is not theirs.
    expect(open[0]!.imbalance).toBe(20);
    expect(open[0]!.bundles).toBe(3);
    // No direction is invented, so nothing is outstanding until somebody says who bent down.
    expect(outstanding(duo, baldrix(), VESTIGE, ORDER)).toEqual([]);
  });

  it("builds both piles once the stacks are named, and only the debtor owes", () => {
    const said = baldrix({ bundlesBy: split });
    expect(unanswered(duo, said, VESTIGE)).toEqual([]);

    const drops = outstanding(duo, said, VESTIGE, ORDER);
    // One row per PILE: the drop sits in two inventories, each draining its own owner's sales.
    expect(drops).toHaveLength(2);
    const mine = drops.find((d) => holderKey(d.holder) === holderKey(SELF))!;
    expect(mine.drop.held).toBe(80);
    // Entitlements are still measured against the whole 120, never against one pile.
    expect(mine.drop.total).toBe(120);

    // Both piles are named for the row's display, not just whichever sorted first.
    expect(ledgerForLoot(holderLedgers(drops, new Map()), "l1")).toHaveLength(2);

    const ledgers = holderLedgers(drops, new Map());
    const yours = ledgers.find((l) => holderKey(l.holder) === holderKey(SELF))!;
    expect(yours.pieces).toBe(80);
    expect(yours.drops[0]!.transfers).toHaveLength(1);
    expect(yours.drops[0]!.transfers[0]!.pieces).toBe(20);
    // The other pile owes nothing, so its row carries no transfer rather than repeating this one.
    const theirs = ledgers.find((l) => holderKey(l.holder) === holderKey(NOVA))!;
    expect(theirs.drops[0]!.transfers).toEqual([]);
  });

  it("prices the debt against the debtor's own pile, not the whole drop", () => {
    // I sell my 80 at 20m each. 20 of them were never mine, so a quarter of that goes across.
    const ledgers = holderLedgers(
      outstanding(duo, baldrix({ bundlesBy: split }), VESTIGE, ORDER),
      salesByHolder([{ holder: SELF, pieces: 80, amount: 1_600 * M }]),
    );
    const yours = ledgers.find((l) => holderKey(l.holder) === holderKey(SELF))!;
    expect(yours.drops[0]!.complete).toBe(true);
    expect(yours.drops[0]!.transfers[0]!.send).toBe(400 * M);
  });

  it("reads a row cached before the fields existed as one that says nothing", () => {
    // lib/cache.ts holds whatever shape the API had when the page last fetched, typed as whatever
    // it is read back as, so a tab open across a deploy gets rows without the new fields. This
    // threw on `bundlesBy.length`, and `undefined !== null` would have let the arithmetic run on
    // nothing and put a NaN on screen.
    const stale = coupon("l9", "baldrix", 120, "2026-08-06");
    delete (stale as Partial<Loot>).bundles;
    delete (stale as Partial<Loot>).bundlesBy;
    const pools = [pool("pt", [stale])];

    expect(() => unanswered(duo, pools, VESTIGE)).not.toThrow();
    expect(unanswered(duo, pools, VESTIGE)).toEqual([]);
    expect(outstanding(duo, pools, VESTIGE, ORDER)).toEqual([]);
  });

  it("leaves an even night alone, and folds one person's characters before deciding", () => {
    // 6 stacks between 2 holders is 3 each, so nothing is out of place and nothing is asked.
    const six = [pool("pt", [coupon("l2", "baldrix", 120, "2026-08-06", { bundles: 6 })])];
    expect(unanswered(duo, six, VESTIGE)).toEqual([]);
    expect(outstanding(duo, six, VESTIGE, ORDER)).toEqual([]);

    // 3 stacks, 3 characters, but two of them are one person: 2 shares against 1, so 2 stacks
    // against 1, and it divides. Reading this per SEAT would invent a debt that does not exist.
    const pair = seat("m3", "Nova2", { person: ["p-nova", "Nova"] });
    const trio = [party("pt", "baldrix", [me, them, pair], null)];
    const drop = [pool("pt", [coupon("l3", "baldrix", 120, "2026-08-06", { bundles: 3 })])];
    expect(unanswered(trio, drop, VESTIGE)).toEqual([]);
    expect(outstanding(trio, drop, VESTIGE, ORDER)).toEqual([]);
  });
});

describe("the arrangement put in front of somebody", () => {
  const me = seat("m1", "Husky", { mine: true });
  const them = seat("m2", "Nova", { person: ["p-nova", "Nova"] });
  const NOVA_KEY = holderKey({ kind: "PERSON", personId: "p-nova", characterName: null });

  it("balances rather than concentrates, because every crossing piece pays the fee twice", () => {
    // Four seats, six stacks. 2,2,1,1 moves one stack of value; 3,1,1,1 moves one and a half.
    const four = [me, them, seat("m3", "Cid"), seat("m4", "Dot")];
    const suggested = suggestArrangement(6, four, new Map());
    expect([...suggested.values()].sort()).toEqual([1, 1, 2, 2]);
  });

  it("gives the odd stack to whoever is furthest behind, so it rotates on its own", () => {
    // Nobody behind: the tie falls to seat order, so the first seat takes the extra.
    expect(suggestArrangement(3, [me, them], new Map()).get("m1")).toBe(2);
    // Nova is owed 20 from an earlier night, so this week's odd stack is hers.
    const rotated = suggestArrangement(3, [me, them], new Map([[NOVA_KEY, 20]]));
    expect(rotated.get("m2")).toBe(2);
    expect(rotated.get("m1")).toBe(1);
  });

  it("gives a bigger share a bigger floor, before the rotation gets a say", () => {
    // Two shares against one is 2 stacks against 1 on the floor alone, so there is no odd stack for
    // the rotation to hand anybody. A party that wants the extra to stop moving says so this way.
    const carried = { ...them, shares: 2 };
    const split = suggestArrangement(3, [me, carried], new Map([[holderKey(SELF), 20]]));
    expect(split.get("m2")).toBe(2);
    expect(split.get("m1")).toBe(1);
  });

  it("leaves a seat out rather than handing them zero stacks", () => {
    // The server refuses a zero: somebody who did not bend down is absent, not present with none.
    const suggested = suggestArrangement(1, [me, them], new Map());
    expect(suggested.has("m2")).toBe(false);
    expect([...suggested.values()].reduce((a, b) => a + b, 0)).toBe(1);
  });

  it("counts a drop once when working out who is behind, not once per pile", () => {
    const duo = [party("pt", "baldrix", [me, them], null)];
    const said = [
      pool("pt", [
        coupon("l1", "baldrix", 120, "2026-08-06", {
          bundles: 3,
          bundlesBy: [
            { memberId: "m1", bundles: 2 },
            { memberId: "m2", bundles: 1 },
          ],
        }),
      ]),
    ];
    const drops = outstanding(duo, said, VESTIGE, ORDER);
    expect(drops).toHaveLength(2);
    // Two rows, one drop. Nova is owed 20, not 40.
    expect(runningBalance(drops).get(NOVA_KEY)).toBe(20);
    expect(runningBalance(drops).get(holderKey(SELF))).toBe(-20);
  });
});

/**
 * A firm agreement, as against the odd stack taking turns.
 *
 * "mechyfechy takes 4 stacks, Freeballynn takes 2" is a SPLIT, not a night that failed to divide.
 * Said as shares it divides exactly, so nothing is outstanding and nobody is asked anything, which
 * is the whole difference between an agreement and a remainder.
 */
describe("a party that has agreed an uneven split", () => {
  const mine = (name: string, shares: number) => ({ ...seat("m1", name, { mine: true }), shares });
  const theirs = (name: string, shares: number) => ({
    ...seat("m2", name, { person: ["p-bro", "Bro"] }),
    shares,
  });

  it("takes the stacks in the ratio it agreed, and leaves nobody owing", () => {
    // Extreme Kalos, 180 in 6 stacks of 30. 6 x 4/6 and 6 x 2/6 is four stacks and two.
    const seats = [mine("mechyfechy", 4), theirs("Freeballynn", 2)];
    const kalos = [party("pk", "kalos-the-guardian", seats, null)];
    const drop = [
      pool("pk", [coupon("l1", "kalos-the-guardian", 180, "2026-08-06", { bundles: 6 })]),
    ];

    expect(suggestArrangement(6, seats, new Map())).toEqual(
      new Map([
        ["m1", 4],
        ["m2", 2],
      ]),
    );
    expect(unanswered(kalos, drop, VESTIGE)).toEqual([]);
    expect(outstanding(kalos, drop, VESTIGE, ORDER)).toEqual([]);
  });

  it("lets one member keep the lot, owing nobody", () => {
    // Hard Limbo is 60 in 3 stacks of 20, and a duo cannot divide 3 stacks. On 1 and 0 there is
    // nothing to divide: Husky is entitled to all three, holds all three, and owes nobody. The
    // party leaves the Drop Log rather than sitting there as a night that will not come out.
    const seats = [mine("Huskyxkenshi", 1), theirs("CourseLair", 0)];
    const limbo = [party("pl", "limbo", seats, null)];
    const drop = [pool("pl", [coupon("l3", "limbo", 60, "2026-08-06", { bundles: 3 })])];

    expect(suggestArrangement(3, seats, new Map())).toEqual(new Map([["m1", 3]]));
    expect(unanswered(limbo, drop, VESTIGE)).toEqual([]);
    expect(outstanding(limbo, drop, VESTIGE, ORDER)).toEqual([]);
  });

  it("still refuses to divide when the shares cannot come out in whole stacks", () => {
    // 3 and 1 is a weight of 4, so Husky is entitled to 2.25 stacks. Nobody can pick that up, so
    // it is a night that does not divide however it is looted. This is what 1 and 0 replaces.
    const seats = [mine("Huskyxkenshi", 3), theirs("CourseLair", 1)];
    const limbo = [party("pl", "limbo", seats, null)];
    const drop = [pool("pl", [coupon("l4", "limbo", 60, "2026-08-06", { bundles: 3 })])];

    expect(unanswered(limbo, drop, VESTIGE)).toHaveLength(1);
    expect(unanswered(limbo, drop, VESTIGE)[0]!.imbalance).toBe(5);
  });

  it("reads 4 and 2 as the same agreement as 2 and 1", () => {
    // The numbers people say to each other go straight in, whichever way they say them.
    const long = suggestArrangement(
      6,
      [mine("mechyfechy", 4), theirs("Freeballynn", 2)],
      new Map(),
    );
    const short = suggestArrangement(
      6,
      [mine("mechyfechy", 2), theirs("Freeballynn", 1)],
      new Map(),
    );
    expect(long).toEqual(short);
  });

  it("settles Malefic Star the same way, where an even split could not", () => {
    // 3 stacks between two. Even, it will not divide and somebody holds 15 that are not theirs.
    // Agreed 2 to 1, it divides exactly and there is nothing to answer.
    const seats = [mine("acornacorn", 1), theirs("CreedBratton", 2)];
    const star = [party("ps", "malefic-star", seats, null)];
    const drop = [pool("ps", [coupon("l2", "malefic-star", 90, "2026-08-06", { bundles: 3 })])];

    expect(suggestArrangement(3, seats, new Map())).toEqual(
      new Map([
        ["m1", 1],
        ["m2", 2],
      ]),
    );
    expect(unanswered(star, drop, VESTIGE)).toEqual([]);
    expect(outstanding(star, drop, VESTIGE, ORDER)).toEqual([]);
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
