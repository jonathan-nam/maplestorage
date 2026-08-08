import { describe, expect, it } from "vitest";
import {
  buildDropLog,
  consolidate,
  forCharacter,
  groupDrops,
  monthLabel,
  weekLabel,
} from "./drop-log";
import { splitOf } from "./loot";
import type { Loot, PartyLootPool } from "@/types/loot";
import type { Party, PartyMember } from "@/types/party";

const mine = (id: string, name: string, characterId = `char-${id}`): PartyMember => ({
  id,
  name,
  personId: null,
  personName: null,
  characterId,
  spriteImgUrl: null,
  guest: false,
  shares: 1,
});

const theirs = (id: string, name: string): PartyMember => ({
  id,
  name,
  personId: "p-chris",
  personName: "Chris",
  characterId: null,
  spriteImgUrl: null,
  guest: false,
  shares: 1,
});

const party = (id: string, members: PartyMember[], over: Partial<Party> = {}): Party => ({
  id,
  characterId: members[0]!.characterId!,
  solo: false,
  retired: false,
  worldType: "INTERACTIVE",
  bossKey: "limbo",
  difficulty: null,
  minutes: null,
  members,
  seats: members,
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

/**
 * The Thursday of the week a date falls in, so a fixture cannot say a drop fell on one day and
 * belongs to another week. The real one is the server's (BossPeriod.kt) and arrives on the row;
 * this only builds rows shaped like the server's.
 */
const weekStartOf = (iso: string): string => {
  const day = new Date(`${iso}T00:00:00Z`);
  // 0 on Thursday itself, counting up to 6 the Wednesday after it.
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 3) % 7));
  return day.toISOString().slice(0, 10);
};

const drop = (over: Partial<Loot> = {}): Loot => {
  const droppedOn = over.droppedOn ?? "2026-07-20";
  return {
    id: "l1",
    dropKey: "grindstone-of-faith",
    customName: null,
    name: "Grindstone of Faith",
    iconUrl: null,
    perMember: null,
    bossKey: "limbo",
    quantity: 1,
    droppedOn,
    weekStart: weekStartOf(droppedOn),
    status: "SOLD",
    saleAmount: 10_000_000_000,
    amountBasis: "LISTED",
    splitMethod: "FAIR",
    sellerShares: 1,
    sellerMemberId: "m1",
    soldAt: "2026-07-21T10:00:00Z",
    payouts: [{ memberId: "m2", paid: false, paidAt: null, shares: 1 }],
    ranThatWeek: [],
    ...over,
  };
};

const pending = (over: Partial<Loot> = {}): Loot =>
  drop({
    status: "PENDING",
    soldAt: null,
    saleAmount: null,
    amountBasis: null,
    splitMethod: null,
    sellerMemberId: null,
    payouts: [],
    ...over,
  });

const pool = (partyId: string, loot: Loot[]): PartyLootPool => ({ partyId, loot });
const duo = () => party("pa", [mine("m1", "mechyfechy"), theirs("m2", "CreedBratton")]);

describe("buildDropLog", () => {
  it("totals what landed in inventories, not the amounts as entered", () => {
    // The claim this file exists for. A listed price and a received price are different
    // quantities; summing them raw would be a confident wrong number. Both rows here are worth
    // the SAME landed amount, entered from opposite ends of the same sale.
    const p = duo();
    const listed = drop({ id: "l1", saleAmount: 10_000_000_000, amountBasis: "LISTED" });
    // 10b listed, less the seller's 5%, is 9.5b received.
    const received = drop({ id: "l2", saleAmount: 9_500_000_000, amountBasis: "RECEIVED" });

    const log = buildDropLog([p], [pool("pa", [listed, received])]);

    expect(log.totals.pooled).toBe(9_500_000_000 * 2);
    // And the raw sum, which is what must NOT be reported, differs from it.
    expect(19_500_000_000).not.toBe(log.totals.pooled);
  });

  it("takes every figure from splitOf rather than computing its own", () => {
    const p = duo();
    const loot = drop();
    const expected = splitOf(loot, p.members)!;

    const log = buildDropLog([p], [pool("pa", [loot])]);
    const entry = log.entries[0]!;

    expect(entry.pooled).toBe(expected.split.sellerReceives);
    expect(entry.yourTake).toBe(expected.seller.keeps);
    expect(entry.sellerName).toBe("mechyfechy");
  });

  it("logs a drop off a boss run alone, with the whole of it yours", () => {
    // A solo pool is a config with one seat, so nothing about the reading changes: the split has
    // no shares, and what there was to split is what you kept. The log is where these appear at
    // all, since Party View does not list them.
    const alone = party("pa", [mine("m1", "mechyfechy")], { solo: true });
    const loot = drop({ payouts: [] });

    const log = buildDropLog([alone], [pool("pa", [loot])]);
    const entry = log.entries[0]!;

    expect(entry.yourTake).toBe(entry.pooled);
    expect(log.totals.pooled).toBe(splitOf(loot, alone.seats)!.split.sellerReceives);
    expect(log.totals.unreadable).toBe(0);
  });

  it("logs a drop on a retired party, given the config", () => {
    // buildDropLog skips a pool whose config it cannot find, so this is what the Drop Log's
    // ?retired=include is for: without the config the drop is not counted short, it is simply
    // absent, and a history that quietly loses rows is the wrong number this repo exists to stop.
    const gone = { ...duo(), retired: true };
    const loot = drop();

    const log = buildDropLog([gone], [pool("pa", [loot])]);

    expect(log.entries.map((e) => e.lootId)).toEqual([loot.id]);
    expect(log.totals.drops).toBe(1);
    expect(log.totals.unreadable).toBe(0);
  });

  it("counts your take as what you netted when somebody else sold it", () => {
    const p = duo();
    const loot = drop({
      sellerMemberId: "m2",
      payouts: [{ memberId: "m1", paid: false, paidAt: null, shares: 1 }],
    });
    const expected = splitOf(loot, p.members)!;

    const log = buildDropLog([p], [pool("pa", [loot])]);

    expect(log.totals.yourTake).toBe(expected.shares[0]!.nets);
    // The pool total is the whole sale either way: it is not your share of it.
    expect(log.totals.pooled).toBe(expected.split.sellerReceives);
  });

  it("counts both halves when two of your own characters are in the party", () => {
    // You sold it and are owed a share of it. Taking only one half would under-count.
    const p = party("pa", [mine("m1", "mechyfechy"), mine("m2", "mechymule", "char-m2")]);
    const loot = drop();
    const expected = splitOf(loot, p.members)!;

    const log = buildDropLog([p], [pool("pa", [loot])]);

    expect(log.totals.yourTake).toBe(expected.seller.keeps + expected.shares[0]!.nets);
  });

  it("keeps unsold drops in the history with no money on them", () => {
    const p = duo();
    const log = buildDropLog([p], [pool("pa", [pending({ id: "l9" })])]);
    const entry = log.entries[0]!;

    expect(log.totals.drops).toBe(1);
    expect(log.totals.pending).toBe(1);
    expect(log.totals.sold).toBe(0);
    expect(entry.pooled).toBeNull();
    expect(entry.yourTake).toBeNull();
    expect(log.totals.pooled).toBe(0);
  });

  it("counts a split it cannot read, and leaves its money out of both totals", () => {
    const p = duo();
    const log = buildDropLog([p], [pool("pa", [drop({ sellerMemberId: "gone" })])]);

    expect(log.totals.unreadable).toBe(1);
    expect(log.totals.sold).toBe(1);
    expect(log.totals.pooled).toBe(0);
    expect(log.totals.yourTake).toBe(0);
    expect(log.entries[0]!.unreadable).toBe(true);
  });

  it("orders the history newest first", () => {
    const p = duo();
    const log = buildDropLog(
      [p],
      [
        pool("pa", [
          drop({ id: "l1", droppedOn: "2026-06-02" }),
          drop({ id: "l2", droppedOn: "2026-07-20" }),
          drop({ id: "l3", droppedOn: "2026-07-04" }),
        ]),
      ],
    );

    expect(log.entries.map((e) => e.droppedOn)).toEqual(["2026-07-20", "2026-07-04", "2026-06-02"]);
  });

  it("skips a pool whose party it cannot see", () => {
    const log = buildDropLog([], [pool("ghost", [drop()])]);
    expect(log.totals.drops).toBe(0);
    expect(log.entries).toHaveLength(0);
  });
});

describe("groupDrops", () => {
  const p = duo();
  const july = () =>
    buildDropLog(
      [p],
      [
        pool("pa", [
          drop({ id: "l1", droppedOn: "2026-06-02" }),
          drop({ id: "l2", droppedOn: "2026-07-20" }),
          drop({ id: "l3", droppedOn: "2026-07-04" }),
        ]),
      ],
    );

  it("groups by month, newest first, and subtotals each", () => {
    const log = july();
    const groups = groupDrops(log.entries, "month");

    expect(groups.map((g) => g.key)).toEqual(["2026-07", "2026-06"]);
    expect(groups[0]!.label).toBe("July 2026");
    expect(groups[0]!.entries.map((e) => e.droppedOn)).toEqual(["2026-07-20", "2026-07-04"]);
    // Each section's subtotal is its own rows, and together they are the whole.
    expect(groups[0]!.pooled + groups[1]!.pooled).toBe(log.totals.pooled);
  });

  it("groups by week on the reset day the row carries, not on the calendar", () => {
    // July 15 is a Wednesday and July 16 the Thursday after it, so these two fell a day apart and
    // in different weeks. Grouping them together would read as one week that ran twice.
    const log = buildDropLog(
      [p],
      [
        pool("pa", [
          drop({ id: "l1", droppedOn: "2026-07-15" }),
          drop({ id: "l2", droppedOn: "2026-07-16" }),
          drop({ id: "l3", droppedOn: "2026-07-20" }),
        ]),
      ],
    );
    const groups = groupDrops(log.entries, "week");

    expect(groups.map((g) => g.key)).toEqual(["2026-07-16", "2026-07-09"]);
    expect(groups[0]!.entries.map((e) => e.droppedOn)).toEqual(["2026-07-20", "2026-07-16"]);
    expect(groups[1]!.entries.map((e) => e.droppedOn)).toEqual(["2026-07-15"]);
    expect(groups[0]!.label).toBe("Week of July 16, 2026");
  });

  it("moves no money when the grouping changes", () => {
    // The tiles above the sections are the log's, not a section sum, and switching the view must
    // not be able to disagree with them.
    const log = july();
    const byMonth = groupDrops(log.entries, "month");
    const byWeek = groupDrops(log.entries, "week");

    const summed = (groups: { pooled: number; yourTake: number }[]) => [
      groups.reduce((sum, g) => sum + g.pooled, 0),
      groups.reduce((sum, g) => sum + g.yourTake, 0),
    ];
    expect(summed(byMonth)).toEqual([log.totals.pooled, log.totals.yourTake]);
    expect(summed(byWeek)).toEqual([log.totals.pooled, log.totals.yourTake]);
  });

  it("has no section for a stretch with nothing in it", () => {
    const log = buildDropLog([p], [pool("pa", [drop({ id: "l1", droppedOn: "2026-07-20" })])]);
    expect(groupDrops(log.entries, "week")).toHaveLength(1);
    expect(groupDrops([], "week")).toHaveLength(0);
  });
});

describe("forCharacter", () => {
  it("recomputes the totals rather than scaling them", () => {
    const one = party("pa", [mine("m1", "mechyfechy"), theirs("m2", "CreedBratton")]);
    const two = party("pb", [mine("m3", "otherchar"), theirs("m4", "CreedBratton")], {
      bossKey: "kalos",
    });

    const log = buildDropLog(
      [one, two],
      [
        pool("pa", [drop({ id: "l1" })]),
        pool("pb", [
          drop({
            id: "l2",
            sellerMemberId: "m3",
            payouts: [{ memberId: "m4", paid: false, paidAt: null, shares: 1 }],
          }),
        ]),
      ],
    );

    const only = forCharacter(log, one.characterId);

    expect(log.totals.drops).toBe(2);
    expect(only.totals.drops).toBe(1);
    expect(only.totals.pooled).toBe(only.entries[0]!.pooled);
    expect(only.entries.every((e) => e.characterId === one.characterId)).toBe(true);
    // Null means every character, unfiltered.
    expect(forCharacter(log, null)).toBe(log);
  });

  it("leaves no section for a month the filter emptied", () => {
    const one = party("pa", [mine("m1", "mechyfechy"), theirs("m2", "CreedBratton")]);
    const two = party("pb", [mine("m3", "otherchar"), theirs("m4", "CreedBratton")]);
    const log = buildDropLog(
      [one, two],
      [pool("pa", [drop({ id: "l1", droppedOn: "2026-06-01" })]), pool("pb", [drop({ id: "l2" })])],
    );

    expect(groupDrops(log.entries, "month")).toHaveLength(2);
    const only = forCharacter(log, one.characterId);
    expect(groupDrops(only.entries, "month").map((g) => g.key)).toEqual(["2026-06"]);
  });
});

describe("monthLabel", () => {
  it("reads the month as written, not as a timezone reads it", () => {
    // new Date("2026-07-01") is UTC midnight, so anyone behind UTC would see June.
    expect(monthLabel("2026-07-01")).toBe("July 2026");
    expect(monthLabel("2026-01-31")).toBe("January 2026");
    expect(monthLabel("2026-12-25")).toBe("December 2026");
  });
});

describe("weekLabel", () => {
  it("carries the year, which two Julys apart would otherwise share", () => {
    expect(weekLabel("2026-07-16")).toBe("Week of July 16, 2026");
    expect(weekLabel("2025-07-16")).toBe("Week of July 16, 2025");
  });

  it("reads the day as written, not as a timezone reads it", () => {
    expect(weekLabel("2026-01-01")).toBe("Week of January 1, 2026");
  });
});

describe("consolidate", () => {
  const coupon = (id: string, bossKey: string, quantity: number, over: Partial<Loot> = {}) =>
    pending({
      id,
      dropKey: "vestige-of-erion",
      name: "Vestige of Erion Coupon",
      bossKey,
      quantity,
      ...over,
    });

  it("folds one drop's rows into a line, and says the total pieces", () => {
    // A week of bossing files a coupon row per boss, which is the same drop listed three times when
    // the only number anybody wants is what they add up to.
    const log = buildDropLog(
      [duo()],
      [
        pool("pa", [
          coupon("l1", "kalos-the-guardian", 90),
          coupon("l2", "limbo", 30),
          coupon("l3", "baldrix", 60),
        ]),
      ],
    );
    const lines = consolidate(log.entries);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.quantity).toBe(180);
    expect(lines[0]!.folded).toBe(true);
    expect(lines[0]!.entries).toHaveLength(3);
  });

  it("leaves a drop that appears once exactly as it was", () => {
    const lines = consolidate(buildDropLog([duo()], [pool("pa", [drop()])]).entries);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.folded).toBe(false);
    expect(lines[0]!.key).toBe("l1");
    expect(lines[0]!.quantity).toBe(1);
  });

  it("never folds free text, which is only ever what somebody typed", () => {
    // Two rows reading "some cape" are not evidence of one drop.
    const log = buildDropLog(
      [duo()],
      [
        pool("pa", [
          pending({ id: "l1", dropKey: null, customName: "Some Cape", name: "Some Cape" }),
          pending({ id: "l2", dropKey: null, customName: "Some Cape", name: "Some Cape" }),
        ]),
      ],
    );
    expect(consolidate(log.entries)).toHaveLength(2);
  });

  it("sums the money over the rows that sold, and says nothing when none did", () => {
    const log = buildDropLog(
      [duo()],
      [
        pool("pa", [
          coupon("l1", "limbo", 30),
          coupon("l2", "baldrix", 60, {
            status: "SOLD",
            soldAt: "2026-07-21T10:00:00Z",
            saleAmount: 1_000_000_000,
            amountBasis: "RECEIVED",
            splitMethod: "FAIR",
            sellerMemberId: "m1",
            payouts: [{ memberId: "m2", paid: false, paidAt: null, shares: 1 }],
          }),
        ]),
      ],
    );
    const line = consolidate(log.entries)[0]!;
    expect(line.quantity).toBe(90);
    expect(line.pooled).toBe(1_000_000_000);

    const unsold = consolidate(
      buildDropLog([duo()], [pool("pa", [coupon("l1", "limbo", 30), coupon("l2", "baldrix", 60)])])
        .entries,
    )[0]!;
    expect(unsold.pooled).toBeNull();
  });
});
