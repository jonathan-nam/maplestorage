import { describe, expect, it } from "vitest";
import {
  type Holder,
  boughtByHolder,
  closedByHolder,
  closureKey,
  holderKey,
  holderLedgers,
  holderOf,
  keptByHolder,
  ledgerForLoot,
  outstanding,
  runningBalance,
  receivedByHolder,
  salesByHolder,
  stillOpen,
  suggestArrangement,
  toCome,
  unaccounted,
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
  takenByMemberId: null,
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
  it("lets a recorded arrangement correct a party that names a looter", () => {
    // #289. The looter is a standing agreement, the arrangement is what happened, and the
    // arrangement used to lose silently: you entered the stacks and the card did not move.
    const p = party("pa", "limbo", trio(), "m1");
    const split = coupon("l1", "limbo", 60, "2026-07-30", {
      bundles: 3,
      bundlesBy: [
        { memberId: "m1", bundles: 1 },
        { memberId: "m2", bundles: 1 },
        { memberId: "m3", bundles: 1 },
      ],
    });

    // A stack each is exactly everybody's share, so nothing is owed and it leaves the queue. Read
    // through the looter instead, this was one seat holding all 60 and owing the other two 20 each.
    expect(outstanding([p], [pool("pa", [split])], VESTIGE, ORDER)).toEqual([]);
  });

  it("still falls back to the looter when no arrangement was recorded", () => {
    const p = party("pa", "limbo", trio(), "m1");
    const uncounted = coupon("l1", "limbo", 60, "2026-07-30", { bundles: 3, bundlesBy: [] });
    const drops = outstanding([p], [pool("pa", [uncounted])], VESTIGE, ORDER);
    expect(drops).toHaveLength(1);
    expect(drops[0]!.looterName).toBe("Husky");
    expect(drops[0]!.drop.seats.map((s) => s.looted)).toEqual([60, 0, 0]);
  });

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

describe("a drop is measured against the week it fell in", () => {
  // A pool spans months and the party is not the same every night: a trio in July, a duo in August.
  // `party.members` is whichever ONE week the page asked for, so reading the pool against it answers
  // for the wrong night. The drop carries its own week's seats, and now they are what is read.
  const roster = trio();
  const [husky, rune] = roster;

  /** The party as this week sees it, which is the duo. Every seat is still on it. */
  const thisWeekIsADuo = (looter: string | null): Party => ({
    ...party("pa", "limbo", roster, looter),
    members: [husky!, rune!],
  });

  it("divides July's trio three ways while this week is a duo", () => {
    const july = coupon("l1", "limbo", 60, "2026-07-30", { ranThatWeek: ["m1", "m2", "m3"] });
    const rows = outstanding([thisWeekIsADuo("m1")], [pool("pa", [july])], VESTIGE, ORDER);

    // Husky looted the lot for three people. Read against this week it would owe Rune 30, which is
    // the whole of Bob's share handed to somebody else.
    expect(rows).toHaveLength(1);
    expect(rows[0]!.drop.seats.map((s) => s.name)).toEqual(["you", "Rune", "Bob"]);
    expect(rows[0]!.drop.seats.map((s) => s.looted)).toEqual([60, 0, 0]);
  });

  it("asks about the duo's night and not the trio's, on one pool holding both", () => {
    // Three stacks of 20. The trio takes one each and owes nobody; the duo cannot, and 10 pieces
    // end up on the wrong side of the party.
    const drops = [
      coupon("l1", "limbo", 60, "2026-07-30", { bundles: 3, ranThatWeek: ["m1", "m2", "m3"] }),
      coupon("l2", "limbo", 60, "2026-08-06", { bundles: 3, ranThatWeek: ["m1", "m2"] }),
    ];
    const open = unanswered([thisWeekIsADuo(null)], [pool("pa", drops)], VESTIGE);

    expect(open.map((d) => d.lootId)).toEqual(["l2"]);
    expect(open[0]!.imbalance).toBe(10);
    // And the stacks may only be handed to the two who were there.
    expect(open[0]!.seats.map((s) => s.name)).toEqual(["Husky", "Rune"]);
  });

  it("hands a stack to the guest who ran that night, not to this week's roster", () => {
    // Bob is out this week. July's odd stack is his, and a card drawing this week's seats could
    // neither say so nor correct it.
    const july = coupon("l1", "limbo", 60, "2026-07-30", { bundles: 3, ranThatWeek: ["m1", "m3"] });
    const open = unanswered([thisWeekIsADuo(null)], [pool("pa", [july])], VESTIGE);

    expect(open[0]!.seats.map((s) => s.name)).toEqual(["Husky", "Bob"]);
  });

  it("falls back to the party when the week names nobody, rather than reading it as empty", () => {
    // Every seat retired and no week spelled out. There is no answer for that week, and an empty
    // roster would say none of the 60 is yours.
    const p = thisWeekIsADuo("m1");
    const rows = outstanding(
      [p],
      [pool("pa", [coupon("l1", "limbo", 60, "2026-07-30")])],
      VESTIGE,
      ORDER,
    );

    expect(rows[0]!.drop.seats.map((s) => s.name)).toEqual(["you", "Rune"]);
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

describe("a holder redeeming their share rather than selling it", () => {
  // The night #281 was written about. A duo, Bro looted all 390, half of it is mine, and he can
  // only ever settle in mesos: a single-trade coupon handed back is one I cannot list.
  const duo = () => [
    seat("m1", "Husky", { mine: true }),
    seat("m2", "BroChar", { person: ["p-bro", "Bro"] }),
  ];

  const night = () => ({
    parties: [party("pa", "limbo", duo(), "m2")],
    pools: [pool("pa", [coupon("l1", "limbo", 390, "2026-08-03")])],
  });

  const ledgerFor = (
    tranches: { holder: Holder; pieces: number; amount: number | null; disposition?: string }[],
  ) => {
    const { parties, pools } = night();
    return holderLedgers(
      outstanding(parties, pools, VESTIGE, ORDER),
      salesByHolder(tranches),
      keptByHolder(tranches),
      boughtByHolder(tranches),
    )[0]!;
  };

  it("sums the redemptions per holder, and leaves the sales out of it", () => {
    const rows = [
      { holder: BRO, pieces: 100, amount: 2_500 * M },
      { holder: BRO, pieces: 95, amount: null },
      { holder: BRO, pieces: 100, amount: null },
      { holder: SELF, pieces: 10, amount: null },
    ];
    expect(keptByHolder(rows).get(holderKey(BRO))).toBe(195);
    expect(keptByHolder(rows).get(holderKey(SELF))).toBe(10);
    expect(salesByHolder(rows).get(holderKey(BRO))).toHaveLength(1);
  });

  it("pays the whole claim once the sellable half has gone", () => {
    // #281 end to end: over the whole 390 this owed 2.44b for a claim that was fully realized.
    const ledger = ledgerFor([
      { holder: BRO, pieces: 195, amount: 4_875 * M },
      { holder: BRO, pieces: 195, amount: null },
    ]);
    const limbo = ledger.drops[0]!;

    expect(ledger.kept).toBe(195);
    expect(limbo.pieces).toBe(390);
    expect(limbo.sellable).toBe(195);
    expect(limbo.complete).toBe(true);
    expect(ledger.dueNow).toBe(4_875 * M);
    expect(limbo.transfers.map((t) => [t.to, t.pieces, t.send])).toEqual([["you", 195, 4_875 * M]]);
  });

  it("counts down to nothing left, so a settled pile stops asking for sales", () => {
    const ledger = ledgerFor([
      { holder: BRO, pieces: 195, amount: 4_875 * M },
      { holder: BRO, pieces: 195, amount: null },
    ]);
    // Against the whole pile this was 195 forever, and the card could not tell a pile that had
    // finished from one still waiting.
    expect(unsold(ledger)).toBe(0);
  });

  it("says the pieces and no price when the whole pile is redeemed", () => {
    const ledger = ledgerFor([{ holder: BRO, pieces: 390, amount: null }]);
    const limbo = ledger.drops[0]!;

    expect(limbo.sellable).toBe(0);
    expect(limbo.complete).toBe(false);
    expect(limbo.averagePrice).toBeNull();
    expect(ledger.dueNow).toBe(0);
    // The debt is real and still owed, it just has no realized price to be stated in.
    expect(limbo.transfers.map((t) => [t.pieces, t.send])).toEqual([[195, null]]);
    // Nothing left to enter, which is what makes this distinguishable from waiting on a sale.
    expect(unsold(ledger)).toBe(0);
  });

  it("carries the count beside the pile, so keeping more than you hold can be said", () => {
    const ledger = ledgerFor([{ holder: BRO, pieces: 500, amount: null }]);
    expect(ledger.kept).toBe(500);
    expect(ledger.pieces).toBe(390);
    expect(ledger.drops[0]!.sellable).toBe(0);
  });

  it("counts your claim in your own units, and keeping changes how fast it moves", () => {
    // The three figures the card leads with. 100 pieces sold out of a pile that is half yours
    // settles 50 of your 195; out of a pile whose sellable half is ALL yours it settles 100.
    const shared = ledgerFor([{ holder: BRO, pieces: 100, amount: 2_500 * M }]);
    expect([shared.owedToYou, shared.settledToYou]).toEqual([195, 50]);

    const keeping = ledgerFor([
      { holder: BRO, pieces: 100, amount: 2_500 * M },
      { holder: BRO, pieces: 195, amount: null },
    ]);
    expect([keeping.owedToYou, keeping.settledToYou]).toEqual([195, 100]);

    // Never more than the claim, so "to go" cannot read negative.
    const done = ledgerFor([
      { holder: BRO, pieces: 195, amount: 4_875 * M },
      { holder: BRO, pieces: 195, amount: null },
    ]);
    expect([done.owedToYou, done.settledToYou]).toEqual([195, 195]);
  });

  it("is unchanged when nobody has redeemed anything", () => {
    const ledger = ledgerFor([{ holder: BRO, pieces: 390, amount: 9_750 * M }]);
    const limbo = ledger.drops[0]!;
    expect(ledger.kept).toBe(0);
    expect(limbo.sellable).toBe(390);
    expect(ledger.dueNow).toBe(4_875 * M);
    expect(unsold(ledger)).toBe(0);
  });

  describe("across several bosses in one queue", () => {
    // Where #281 came back. One drop hid it: a redemption is spread over the QUEUE, so it is only
    // with a second boss that the kept pieces can land on the wrong entitlements. Bro loots both
    // nights of one week, holds 300, and half of each is mine.
    const week = () => ({
      parties: [
        party("pa", "kalos-the-guardian", duo(), "m2"),
        party("pb", "baldrix", duo(), "m2"),
      ],
      pools: [
        pool("pa", [coupon("l1", "kalos-the-guardian", 180, "2026-08-06")]),
        pool("pb", [coupon("l2", "baldrix", 120, "2026-08-06")]),
      ],
    });

    const weekFor = (
      tranches: { holder: Holder; pieces: number; amount: number | null; disposition?: string }[],
    ) => {
      const { parties, pools } = week();
      return holderLedgers(
        outstanding(parties, pools, VESTIGE, ORDER),
        salesByHolder(tranches),
        keptByHolder(tranches),
        boughtByHolder(tranches),
      )[0]!;
    };

    it("clears when a holder keeps their own half and sells mine", () => {
      const ledger = weekFor([
        { holder: BRO, pieces: 150, amount: 3_750 * M },
        { holder: BRO, pieces: 150, amount: null },
      ]);

      // Every boss holds back only Bro's own share, so my half of each is what his sale covered.
      expect(ledger.drops.map((d) => [d.bossKey, d.kept, d.sellable, d.covered])).toEqual([
        ["kalos-the-guardian", 90, 90, 90],
        ["baldrix", 60, 60, 60],
      ]);
      // Taken off whole bosses instead, baldrix was wholly kept and read "no sale to price them"
      // for good, and this settled 90 of 150 with 1.5b of the 3.75b unpaid.
      expect([ledger.owedToYou, ledger.settledToYou]).toEqual([150, 150]);
      expect(ledger.dueNow).toBe(3_750 * M);
      expect(unsold(ledger)).toBe(0);
      expect(ledger.drops.every((d) => d.complete)).toBe(true);
    });

    it("takes a part-redemption off the newest boss's own share first", () => {
      const ledger = weekFor([{ holder: BRO, pieces: 60, amount: null }]);
      expect(ledger.drops.map((d) => [d.bossKey, d.kept, d.sellable])).toEqual([
        ["kalos-the-guardian", 0, 180],
        ["baldrix", 60, 60],
      ]);
    });
  });

  describe("a lopsided split where the small share loots the lot", () => {
    // 60 pieces, 40 mine and 20 his because I brought two characters, and he picks up all 60. His
    // own share is a THIRD of the pile, so a redemption reads against 20, not against half of 60.
    //
    // Reachable without the config's uneven-split mode, which is the point of pinning it: that
    // control and the looter one are the same select, so "one member takes more" and "one member
    // loots everything" cannot both be chosen. Every seat here has 1 share and the 2:1 comes from
    // the FOLD, which the config never sees as uneven at all.
    const lopsided = () => [
      seat("m1", "Husky", { mine: true }),
      seat("m1b", "HuskyAlt", { mine: true }),
      seat("m2", "BroChar", { person: ["p-bro", "Bro"] }),
    ];

    const oneNight = (
      tranches: { holder: Holder; pieces: number; amount: number | null; disposition?: string }[],
    ) =>
      holderLedgers(
        outstanding(
          [party("pa", "limbo", lopsided(), "m2")],
          [pool("pa", [coupon("l1", "limbo", 60, "2026-08-06")])],
          VESTIGE,
          ORDER,
        ),
        salesByHolder(tranches),
        keptByHolder(tranches),
        boughtByHolder(tranches),
      )[0]!;

    it("owes me two thirds, and keeping his own third leaves all of mine sellable", () => {
      const ledger = oneNight([
        { holder: BRO, pieces: 20, amount: null },
        { holder: BRO, pieces: 40, amount: 800 * M },
      ]);
      const limbo = ledger.drops[0]!;

      expect(limbo.pieces).toBe(60);
      expect(limbo.kept).toBe(20);
      expect(limbo.sellable).toBe(40);
      expect([ledger.owedToYou, ledger.settledToYou]).toEqual([40, 40]);
      expect(ledger.dueNow).toBe(800 * M);
      expect(unsold(ledger)).toBe(0);
    });

    it("prices the pieces of mine he redeems at the average his own sales got", () => {
      // He keeps 30 of the 60 when only 20 are his, so 10 of mine are gone. The 30 he sold went at
      // 20m, and my 40 are owed at that: 800m, more than the 600m he took in.
      const ledger = oneNight([
        { holder: BRO, pieces: 30, amount: null },
        { holder: BRO, pieces: 30, amount: 600 * M },
      ]);
      const limbo = ledger.drops[0]!;

      expect(limbo.sellable).toBe(30);
      expect(limbo.transfers.map((t) => [t.to, t.pieces, t.send])).toEqual([["you", 40, 800 * M]]);
      expect([ledger.owedToYou, ledger.settledToYou]).toEqual([40, 40]);
    });

    it("prices the pieces he took at what he agreed, not at his own average", () => {
      // V50. He keeps his own 20, and takes 10 of mine at 15m rather than the 20m his sale reached.
      // Folded into KEPT, those 10 were priced at his 20m: a figure nobody agreed to.
      const ledger = oneNight([
        { holder: BRO, pieces: 20, amount: null, disposition: "KEPT" },
        { holder: BRO, pieces: 10, amount: 150 * M, disposition: "BOUGHT" },
        { holder: BRO, pieces: 30, amount: 600 * M, disposition: "SOLD" },
      ]);
      const limbo = ledger.drops[0]!;

      // 60 held, 20 his and redeemed, 10 of mine taken, so 30 left to sell and all 30 are mine.
      expect(limbo.sellable).toBe(30);
      expect(limbo.bought).toEqual({ pieces: 10, paid: 150 * M });
      expect(limbo.complete).toBe(true);
      // The 30 sold are mine in full, plus the 10 at the price he agreed.
      expect(limbo.transfers.map((t) => [t.pieces, t.settled, t.send])).toEqual([
        [40, 40, 750 * M],
      ]);
      expect([ledger.owedToYou, ledger.settledToYou]).toEqual([40, 40]);
      expect(ledger.dueNow).toBe(750 * M);
      expect(unsold(ledger)).toBe(0);
    });

    it("keeps a purchase out of the sale queue, so it is not divided pro rata", () => {
      // A BOUGHT row carries money and is still not a sale. Spent on the queue it would price other
      // bosses, and in a party of three it would hand slices of one creditor's money to the others.
      const rows = [
        { holder: BRO, pieces: 10, amount: 150 * M, disposition: "BOUGHT" as const },
        { holder: BRO, pieces: 30, amount: 600 * M, disposition: "SOLD" as const },
      ];
      expect(salesByHolder(rows).get(holderKey(BRO))).toHaveLength(1);
      expect(boughtByHolder(rows).get(holderKey(BRO))).toEqual({ pieces: 10, paid: 150 * M });
      // Not a redemption either, which reads the amount rather than the disposition.
      expect(keptByHolder(rows).get(holderKey(BRO))).toBeUndefined();
    });

    it("reads a row cached from before BOUGHT existed as the sale it is", () => {
      // lib/cache.ts hands back whatever shape the API had when the page last fetched, so a tab open
      // across the deploy gets rows with no disposition at all. Absent must never read as BOUGHT:
      // testing for SOLD instead would drop every sale already entered.
      const stale = [{ holder: BRO, pieces: 30, amount: 600 * M }];
      expect(salesByHolder(stale).get(holderKey(BRO))).toHaveLength(1);
      expect(boughtByHolder(stale).get(holderKey(BRO))).toBeUndefined();
    });

    it("has no price to state at all once he has redeemed every piece", () => {
      const ledger = oneNight([{ holder: BRO, pieces: 60, amount: null }]);
      const limbo = ledger.drops[0]!;

      expect(limbo.sellable).toBe(0);
      // The debt is 40 and it is real. Nothing was ever listed, so there is no average to price it
      // at, and a figure here would be one nobody was offered.
      expect(limbo.transfers.map((t) => [t.pieces, t.send])).toEqual([[40, null]]);
      expect([ledger.owedToYou, ledger.settledToYou]).toEqual([40, 0]);
    });
  });
});

describe("the money arriving, which nothing else can know", () => {
  // A duo, Bro loots all 390, half is mine, and he keeps his own half and sells mine.
  const duo = () => [
    seat("m1", "Husky", { mine: true }),
    seat("m2", "BroChar", { person: ["p-bro", "Bro"] }),
  ];

  const ledgerFor = (paid: number[]) =>
    holderLedgers(
      outstanding(
        [party("pa", "limbo", duo(), "m2")],
        [pool("pa", [coupon("l1", "limbo", 390, "2026-08-03")])],
        VESTIGE,
        ORDER,
      ),
      salesByHolder([{ holder: BRO, pieces: 195, amount: 4_875 * M }]),
      keptByHolder([{ holder: BRO, pieces: 195, amount: null }]),
      new Map(),
      receivedByHolder(paid.map((amount) => ({ holder: BRO, amount }))),
    )[0]!;

  it("leaves a fully sold pile outstanding until the mesos come", () => {
    // The confusion this exists for: 195 kept and 195 sold is every piece accounted for, and the
    // card still had to be shown, because priced and paid are different facts.
    const billed = ledgerFor([]);
    expect([billed.owedToYou, billed.settledToYou]).toEqual([195, 195]);
    expect(unsold(billed)).toBe(0);
    expect(billed.dueNow).toBe(4_875 * M);
    expect(billed.received).toBe(0);
    expect(toCome(billed)).toBe(4_875 * M);
    expect(billed.settled).toBe(false);
  });

  it("settles once it has all arrived, and sums the instalments to get there", () => {
    const part = ledgerFor([2_000 * M]);
    expect(part.received).toBe(2_000 * M);
    expect(toCome(part)).toBe(2_875 * M);
    expect(part.settled).toBe(false);

    // Instalments are the point of the pro rata, so several receipts add up to one payment.
    const done = ledgerFor([2_000 * M, 1_875 * M, 1_000 * M]);
    expect(done.received).toBe(4_875 * M);
    expect(toCome(done)).toBe(0);
    expect(done.settled).toBe(true);
  });

  it("says an overpayment rather than netting it into a credit", () => {
    const over = ledgerFor([5_000 * M]);
    expect(over.received).toBe(5_000 * M);
    // Floored, so "to come" cannot read negative and imply I owe him the difference.
    expect(toCome(over)).toBe(0);
    expect(over.settled).toBe(true);
    // The raw figures are both carried, so the card can name the 125m rather than absorb it.
    expect(over.received - over.dueNow).toBe(125 * M);
  });

  it("sums receipts per holder, and keeps one person's off another's", () => {
    const rows = [
      { holder: BRO, amount: 2_000 * M },
      { holder: BRO, amount: 875 * M },
      { holder: SELF, amount: 10 * M },
    ];
    expect(receivedByHolder(rows).get(holderKey(BRO))).toBe(2_875 * M);
    expect(receivedByHolder(rows).get(holderKey(SELF))).toBe(10 * M);
  });

  it("puts a settled pile last, still listed so its rows can be corrected", () => {
    const ledgers = holderLedgers(
      outstanding(
        [
          party("pa", "limbo", duo(), "m2"),
          party(
            "pb",
            "baldrix",
            [seat("m3", "Husky", { mine: true }), seat("m4", "Zed", { person: ["p-zed", "Zed"] })],
            "m4",
          ),
        ],
        [
          pool("pa", [coupon("l1", "limbo", 390, "2026-08-03")]),
          pool("pb", [coupon("l2", "baldrix", 60, "2026-08-03")]),
        ],
        VESTIGE,
        ORDER,
      ),
      salesByHolder([{ holder: BRO, pieces: 195, amount: 4_875 * M }]),
      keptByHolder([{ holder: BRO, pieces: 195, amount: null }]),
      new Map(),
      receivedByHolder([{ holder: BRO, amount: 4_875 * M }]),
    );
    // Bro is settled and Zed has not even sold, so Bro sorts after him despite the name order.
    expect(ledgers.map((l) => [l.holderName, l.settled])).toEqual([
      ["Zed", false],
      ["Bro", true],
    ]);
  });
});

describe("what the card is still waiting to be told", () => {
  // The pile is 390, half of it mine, and Bro loots the lot.
  const duo = () => [
    seat("m1", "Husky", { mine: true }),
    seat("m2", "BroChar", { person: ["p-bro", "Bro"] }),
  ];

  const ledgerFor = (
    rows: { holder: Holder; pieces: number; amount: number | null; disposition?: string }[],
  ) =>
    holderLedgers(
      outstanding(
        [party("pa", "limbo", duo(), "m2")],
        [pool("pa", [coupon("l1", "limbo", 390, "2026-08-03")])],
        VESTIGE,
        ORDER,
      ),
      salesByHolder(rows),
      keptByHolder(rows),
      boughtByHolder(rows),
    )[0]!;

  it("counts every fate towards the pile, so the gap is what is left to enter", () => {
    const fresh = ledgerFor([]);
    expect([fresh.accounted, unaccounted(fresh)]).toEqual([0, 390]);

    // Each of the three closes the gap by its own pieces, whatever it did with them.
    const part = ledgerFor([
      { holder: BRO, pieces: 100, amount: 2_500 * M, disposition: "SOLD" },
      { holder: BRO, pieces: 50, amount: null, disposition: "KEPT" },
      { holder: BRO, pieces: 25, amount: 600 * M, disposition: "BOUGHT" },
    ]);
    expect([part.soldPieces, part.kept, part.bought.pieces]).toEqual([100, 50, 25]);
    expect([part.accounted, unaccounted(part)]).toEqual([175, 215]);
  });

  it("closes to nothing when the whole pile is spoken for", () => {
    const done = ledgerFor([
      { holder: BRO, pieces: 195, amount: 4_875 * M, disposition: "SOLD" },
      { holder: BRO, pieces: 195, amount: null, disposition: "KEPT" },
    ]);
    expect([done.accounted, unaccounted(done)]).toEqual([390, 0]);
  });

  it("floors at zero and carries the surplus, rather than reading negative", () => {
    // More entered than the pile holds. Said, not clamped: the raw figures are both here so the card
    // can name the excess instead of quietly absorbing it.
    const over = ledgerFor([{ holder: BRO, pieces: 400, amount: 10_000 * M, disposition: "SOLD" }]);
    expect(over.accounted).toBe(400);
    expect(unaccounted(over)).toBe(0);
    expect(over.accounted - over.pieces).toBe(10);
  });
});

describe("closing the books, which no arithmetic is entitled to do", () => {
  const duo = () => [
    seat("m1", "Husky", { mine: true }),
    seat("m2", "BroChar", { person: ["p-bro", "Bro"] }),
  ];
  const week = () => ({
    parties: [party("pa", "kalos-the-guardian", duo(), "m2"), party("pb", "baldrix", duo(), "m2")],
    pools: [
      pool("pa", [coupon("l1", "kalos-the-guardian", 180, "2026-08-06")]),
      pool("pb", [coupon("l2", "baldrix", 120, "2026-08-06")]),
    ],
  });

  /** The card for whichever of the two nights have been logged, with whatever has been closed. */
  const ledgerOf = (
    logged: string[],
    settlements: { holder: Holder; lootIds: string[]; unpaid: number }[],
  ) => {
    const { parties, pools } = week();
    const rows = [
      { holder: BRO, pieces: 150, amount: 3_750 * M, disposition: "SOLD" },
      { holder: BRO, pieces: 150, amount: null, disposition: "KEPT" },
    ];
    const only = pools.map((p) => ({ ...p, loot: p.loot.filter((l) => logged.includes(l.id)) }));
    return holderLedgers(
      outstanding(parties, only, VESTIGE, ORDER),
      salesByHolder(rows),
      keptByHolder(rows),
      boughtByHolder(rows),
      receivedByHolder([{ holder: BRO, amount: 3_700 * M }]),
      closedByHolder(settlements),
    )[0]!;
  };

  const ledgerFor = (settlements: { holder: Holder; lootIds: string[]; unpaid: number }[]) =>
    ledgerOf(["l1", "l2"], settlements);

  it("leaves a pile that balanced almost-but-not-quite open, since only a person can close it", () => {
    const open = ledgerFor([]);
    // Every piece accounted for and 3.7b of 3.75b in. No arithmetic may call that done.
    expect(unaccounted(open)).toBe(0);
    expect(toCome(open)).toBe(50 * M);
    expect(open.closed).toBe(false);
    expect(open.drops.every((d) => !d.closed)).toBe(true);
  });

  it("closes the drops it names, and records what was written off", () => {
    const done = ledgerFor([{ holder: BRO, lootIds: ["l1", "l2"], unpaid: 50 * M }]);
    expect(done.closed).toBe(true);
    expect(done.writtenOff).toBe(50 * M);
    expect(done.drops.every((d) => d.closed)).toBe(true);
  });

  it("closes only what it names, so next week's drop reopens the card", () => {
    // The reason a settlement names DROPS and not a date: anything it did not name is still live.
    const half = ledgerFor([{ holder: BRO, lootIds: ["l1"], unpaid: 0 }]);
    expect(half.closed).toBe(false);
    expect(half.drops.map((d) => [d.bossKey, d.closed])).toEqual([
      ["kalos-the-guardian", true],
      ["baldrix", false],
    ]);
  });

  it("freezes a closed drop at what it was worth the day it was closed", () => {
    // The failure this exists for. A drop logged later takes redemption off the newest end of the
    // queue, which changes what the drops behind it have left to sell. On a real account that
    // rewrote two already-paid debts, of 747m and 1.49b, to zero, and said nothing.
    const l1Of = (l: ReturnType<typeof ledgerOf>) => l.drops.find((d) => d.lootId === "l1")!;
    // What the card said when l1 was the whole pile, which is the state it was settled in.
    const settled = l1Of(ledgerOf(["l1"], []));
    // The same drop once next week's l2 has been logged.
    const later = l1Of(ledgerOf(["l1", "l2"], [{ holder: BRO, lootIds: ["l1"], unpaid: 0 }]));
    expect(later.kept).toBe(settled.kept);
    expect(later.sellable).toBe(settled.sellable);
    expect(later.covered).toBe(settled.covered);
    expect(later.transfers.map((t) => t.send)).toEqual(settled.transfers.map((t) => t.send));
  });

  it("counts only what is still open, so a paid debt is not asked for a second time", () => {
    const half = ledgerFor([{ holder: BRO, lootIds: ["l1"], unpaid: 0 }]);
    // l2 alone: Bro looted all 120 and half of them are Husky's.
    expect(half.pieces).toBe(120);
    expect(half.owedToYou).toBe(60);
    // l1 keeps its row, because that is where a mistyped tranche of it is still corrected.
    expect(half.drops.map((d) => [d.lootId, d.closed])).toEqual([
      ["l1", true],
      ["l2", false],
    ]);
  });

  it("spends what arrived on the drops it closed before the ones still open", () => {
    // Otherwise a holder who has paid billions over months reads as having already paid the debt
    // that turned up this morning, because the receipts are one running total and nothing spends it.
    const owedOnClosed = ledgerOf(["l1"], []).dueNow;
    const half = ledgerFor([{ holder: BRO, lootIds: ["l1"], unpaid: 0 }]);
    expect(half.received).toBe(Math.max(0, 3_700 * M - owedOnClosed));
    expect(half.settled).toBe(false);
  });

  it("is keyed per holder and drop, so one person's closure is not another's", () => {
    expect(closureKey(BRO, "l1")).not.toBe(closureKey(SELF, "l1"));
    const { closed } = closedByHolder([{ holder: BRO, lootIds: ["l1"], unpaid: 0 }]);
    expect(closed.has(closureKey(BRO, "l1"))).toBe(true);
    expect(closed.has(closureKey(SELF, "l1"))).toBe(false);
  });

  it("stops a closed debt tilting next week's arrangement", () => {
    const { parties, pools } = week();
    const drops = outstanding(parties, pools, VESTIGE, ORDER);
    const { closed } = closedByHolder([{ holder: BRO, lootIds: ["l1", "l2"], unpaid: 0 }]);

    // Bro is 150 pieces over across the two nights and has paid for it, so he is no longer behind.
    expect(runningBalance(drops).get(holderKey(BRO))).toBe(-150);
    expect(stillOpen(drops, closed)).toEqual([]);
    expect(runningBalance(stillOpen(drops, closed)).size).toBe(0);
  });
});
