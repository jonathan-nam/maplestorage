import { describe, expect, it } from "vitest";
import {
  buildDropLog,
  byCharacter,
  consolidate,
  couponsOwedByParty,
  dropStatusLabel,
  foldNames,
  foldStatus,
  forCharacter,
  groupDrops,
  monthLabel,
  oneBossBehind,
  pieceStatusByParty,
  weekLabel,
} from "./drop-log";
import type { DropEntry } from "./drop-log";
import { closedByHolder, holderOf } from "./vestige-ledger";
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
    takenByMemberId: null,
    soldAt: "2026-07-21T10:00:00Z",
    payouts: [{ memberId: "m2", paid: false, paidAt: null, shares: 1 }],
    ranThatWeek: [],
    bundles: null,
    bundlesBy: [],
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

/** Roster order, as /api/characters returns it. Most fixtures are one character. */
const ORDER = ["char-m1", "char-m2"];
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

    const log = buildDropLog([p], [pool("pa", [listed, received])], {});

    expect(log.totals.pooled).toBe(9_500_000_000 * 2);
    // And the raw sum, which is what must NOT be reported, differs from it.
    expect(19_500_000_000).not.toBe(log.totals.pooled);
  });

  it("takes every figure from splitOf rather than computing its own", () => {
    const p = duo();
    const loot = drop();
    const expected = splitOf(loot, p.members)!;

    const log = buildDropLog([p], [pool("pa", [loot])], {});
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

    const log = buildDropLog([alone], [pool("pa", [loot])], {});
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

    const log = buildDropLog([gone], [pool("pa", [loot])], {});

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

    const log = buildDropLog([p], [pool("pa", [loot])], {});

    expect(log.totals.yourTake).toBe(expected.shares[0]!.nets);
    // The pool total is the whole sale either way: it is not your share of it.
    expect(log.totals.pooled).toBe(expected.split.sellerReceives);
  });

  it("counts both halves when two of your own characters are in the party", () => {
    // You sold it and are owed a share of it. Taking only one half would under-count.
    const p = party("pa", [mine("m1", "mechyfechy"), mine("m2", "mechymule", "char-m2")]);
    const loot = drop();
    const expected = splitOf(loot, p.members)!;

    const log = buildDropLog([p], [pool("pa", [loot])], {});

    expect(log.totals.yourTake).toBe(expected.seller.keeps + expected.shares[0]!.nets);
  });

  it("keeps unsold drops in the history with no money on them", () => {
    const p = duo();
    const log = buildDropLog([p], [pool("pa", [pending({ id: "l9" })])], {});
    const entry = log.entries[0]!;

    expect(log.totals.drops).toBe(1);
    expect(log.totals.pending).toBe(1);
    expect(log.totals.sold).toBe(0);
    expect(entry.pooled).toBeNull();
    expect(entry.yourTake).toBeNull();
    expect(log.totals.pooled).toBe(0);
  });

  it("counts a taken drop as taken, never as sold", () => {
    // "Sold" used to be everything that was not PENDING, so the moment TAKEN existed a Heroic
    // account's claimed drops were reported as sales: a meso word over a drop no money ever
    // changed hands for, on a tile that is drawn in every world.
    const p = duo();
    const log = buildDropLog(
      [p],
      [pool("pa", [pending({ id: "l9", status: "TAKEN", takenByMemberId: "m1" })])],
      {},
    );

    expect(log.totals.taken).toBe(1);
    expect(log.totals.sold).toBe(0);
    // Nor is it work still to do: somebody has it.
    expect(log.totals.pending).toBe(0);
    expect(log.totals.pooled).toBe(0);
    expect(log.totals.yourTake).toBe(0);
  });

  it("counts a split it cannot read, and leaves its money out of both totals", () => {
    const p = duo();
    const log = buildDropLog([p], [pool("pa", [drop({ sellerMemberId: "gone" })])], {});

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
      {},
    );

    expect(log.entries.map((e) => e.droppedOn)).toEqual(["2026-07-20", "2026-07-04", "2026-06-02"]);
  });

  it("skips a pool whose party it cannot see", () => {
    const log = buildDropLog([], [pool("ghost", [drop()])], {});
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
      {},
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
      {},
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
    const log = buildDropLog([p], [pool("pa", [drop({ id: "l1", droppedOn: "2026-07-20" })])], {});
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
      {},
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
      {},
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
      {},
    );
    const lines = consolidate(log.entries, ORDER);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.yours).toBe(180);
    expect(lines[0]!.folded).toBe(true);
    expect(lines[0]!.entries).toHaveLength(3);
  });

  it("leaves a drop that appears once exactly as it was", () => {
    const lines = consolidate(buildDropLog([duo()], [pool("pa", [drop()])], {}).entries, ORDER);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.folded).toBe(false);
    expect(lines[0]!.key).toBe("l1");
    expect(lines[0]!.yours).toBe(1);
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
      {},
    );
    expect(consolidate(log.entries, ORDER)).toHaveLength(2);
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
      {},
    );
    const line = consolidate(log.entries, ORDER)[0]!;
    expect(line.yours).toBe(90);
    expect(line.pooled).toBe(1_000_000_000);

    const unsold = consolidate(
      buildDropLog(
        [duo()],
        [pool("pa", [coupon("l1", "limbo", 30), coupon("l2", "baldrix", 60)])],
        {},
      ).entries,
      ORDER,
    )[0]!;
    expect(unsold.pooled).toBeNull();
  });

  it("puts a fold's runs in roster order, newest first inside each character", () => {
    // Three characters, interleaved by date. Newest-first alone made reading one character's
    // night a matter of picking their rows out of the list.
    const one = party("pa", [mine("m1", "Huskyxkenshi")]);
    const two = party("pb", [mine("m2", "acornacorn", "char-m2")]);
    const three = party("pc", [mine("m3", "warrior2020", "char-m3")]);
    const log = buildDropLog(
      [one, two, three],
      [
        pool("pa", [drop({ id: "l1", droppedOn: "2026-07-20" })]),
        pool("pb", [drop({ id: "l2", droppedOn: "2026-07-22" })]),
        pool("pc", [drop({ id: "l3", droppedOn: "2026-07-21" })]),
        pool("pa", [drop({ id: "l4", droppedOn: "2026-07-23" })]),
      ],
      {},
    );

    // The roster says warrior2020 first, then Husky, then acornacorn, and that is the order the
    // runs read in whatever order they fell.
    const roster = ["char-m3", "char-m1", "char-m2"];
    const line = consolidate(log.entries, roster)[0]!;
    expect(line.entries.map((e) => e.lootId)).toEqual(["l3", "l4", "l1", "l2"]);

    // Husky's own two are still newest first within their group.
    const husky = line.entries.filter((e) => e.characterId === "char-m1");
    expect(husky.map((e) => e.droppedOn)).toEqual(["2026-07-23", "2026-07-20"]);
  });

  it("puts a character the roster does not name last, not first", () => {
    // A missing index reads as 0 if it is not guarded, which would float a departed character to
    // the top of every fold.
    const one = party("pa", [mine("m1", "Huskyxkenshi")]);
    const gone = party("pb", [mine("m2", "Ghost", "char-gone")]);
    const log = buildDropLog(
      [one, gone],
      [pool("pb", [drop({ id: "l1" })]), pool("pa", [drop({ id: "l2" })])],
      {},
    );
    const line = consolidate(log.entries, ["char-m1"])[0]!;
    expect(line.entries.map((e) => e.lootId)).toEqual(["l2", "l1"]);
  });

  it("keeps every row behind the fold, so each run can still be reached", () => {
    // The line is the total; the rows under it are the runs it came off. Dropping any of them would
    // leave a count of pieces with no way to see where they came from.
    const log = buildDropLog(
      [duo()],
      [
        pool("pa", [
          coupon("l1", "kalos-the-guardian", 90, { droppedOn: "2026-08-03" }),
          coupon("l2", "limbo", 30, { droppedOn: "2026-08-05" }),
        ]),
      ],
      {},
    );
    const line = consolidate(log.entries, ORDER)[0]!;

    expect(line.entries.map((e) => e.lootId)).toEqual(["l2", "l1"]);
    expect(line.entries.map((e) => e.quantity)).toEqual([30, 90]);
    expect(line.yours).toBe(line.entries.reduce((sum, e) => sum + e.quantity, 0));
  });
});

describe("byCharacter", () => {
  /** Sold by the one seat that is in the party, so every row's split can be read. */
  const alone = (id: string, seller: string, droppedOn: string) =>
    drop({ id, droppedOn, sellerMemberId: seller, payouts: [] });

  /** Three characters' worth of one drop, folded, in the roster order consolidate() puts them in. */
  const fold = (roster: string[]) => {
    const log = buildDropLog(
      [
        party("pa", [mine("m1", "Huskyxkenshi")]),
        party("pb", [mine("m2", "acornacorn", "char-m2")]),
        party("pc", [mine("m3", "warrior2020", "char-m3")]),
      ],
      [
        pool("pa", [alone("l1", "m1", "2026-07-20")]),
        pool("pb", [alone("l2", "m2", "2026-07-22")]),
        pool("pc", [alone("l3", "m3", "2026-07-21")]),
        pool("pa", [alone("l4", "m1", "2026-07-23")]),
      ],
      {},
    );
    return consolidate(log.entries, roster)[0]!;
  };

  it("splits a fold by character and subtotals what each of them got", () => {
    const folds = byCharacter(fold(["char-m1", "char-m2", "char-m3"]).entries);
    expect(folds.map((f) => f.characterId)).toEqual(["char-m1", "char-m2", "char-m3"]);
    expect(folds.map((f) => f.yours)).toEqual([2, 1, 1]);
    expect(folds[0]!.entries.map((e) => e.lootId)).toEqual(["l4", "l1"]);
  });

  it("keeps the roster order the fold arrived in, rather than reaching for its own", () => {
    // Two orders for one list is two lists: the runs are already sorted, so this walks them.
    const folds = byCharacter(fold(["char-m3", "char-m1", "char-m2"]).entries);
    expect(folds.map((f) => f.characterId)).toEqual(["char-m3", "char-m1", "char-m2"]);
  });

  it("loses no run: every row behind the fold is behind exactly one character", () => {
    const line = fold(["char-m1", "char-m2", "char-m3"]);
    const behind = byCharacter(line.entries).flatMap((f) => f.entries.map((e) => e.lootId));
    expect(behind.sort()).toEqual(line.entries.map((e) => e.lootId).sort());
    expect(byCharacter(line.entries).reduce((sum, f) => sum + f.yours, 0)).toBe(line.yours);
  });

  it("sums the money over the rows that sold, and says nothing when none did", () => {
    const sold = byCharacter(fold(["char-m1", "char-m2", "char-m3"]).entries)[0]!;
    // Two sales of 10b listed, the seller's fee off each. Whatever splitOf makes of one, the pair
    // is twice it: this file never re-derives a split.
    expect(sold.pooled).toBe((sold.entries[0]!.pooled ?? 0) * 2);

    const log = buildDropLog(
      [party("pa", [mine("m1", "Huskyxkenshi")])],
      [pool("pa", [pending({ id: "l1" }), pending({ id: "l2", droppedOn: "2026-07-22" })])],
      {},
    );
    const unsold = byCharacter(consolidate(log.entries, ["char-m1"])[0]!.entries)[0]!;
    expect(unsold.pooled).toBeNull();
    expect(unsold.yourTake).toBeNull();
  });
});

describe("foldStatus", () => {
  const entry = (over: Partial<DropEntry>): DropEntry =>
    ({ status: "PENDING", pieces: false, owedBy: null, closed: false, ...over }) as DropEntry;

  it("says the one status when every row agrees", () => {
    expect(foldStatus([entry({}), entry({})])).toBe("In the pool");
  });

  it("counts the rows instead when they disagree", () => {
    // "In the pool" over a line that is half sold would be the wrong half.
    expect(foldStatus([entry({}), entry({ status: "SOLD" })])).toBe("2 runs");
  });

  it("reads each row the way the row reads itself, not off its raw status", () => {
    // Coupon rows never sell, so they are PENDING for ever. Off the raw status this fold would be
    // "In the pool" about pieces that are already in the inventory.
    const coupons = [entry({ pieces: true }), entry({ pieces: true })];
    expect(foldStatus(coupons)).toBe("Yours");
    expect(foldStatus([...coupons, entry({ pieces: true, owedBy: "CreedBratton" })])).toBe(
      "3 runs",
    );
  });
});

describe("a piece drop counts YOUR share, not what fell", () => {
  const VESTIGE = "vestige-of-erion";

  /** The catalog's own table: 60 coupons off Hard Limbo, which is what makes it divide by count. */
  const tables = {
    limbo: [
      {
        dropKey: VESTIGE,
        name: "Vestige of Erion Coupon",
        iconUrl: null,
        perMember: null,
        worlds: "INTERACTIVE",
        quantity: 1,
        // A piece drop settles through the tranche ledger, not by being sold as a lot.
        fungible: false,
        pieces: { HARD: 60 },
        bundles: { HARD: 3 },
      },
    ],
  };

  const coupons = (over: Partial<Loot> = {}): Loot =>
    pending({ dropKey: VESTIGE, name: "Vestige of Erion Coupon", quantity: 60, ...over });

  const trio = (over: Partial<Party> = {}) =>
    party("pa", [mine("m1", "Huskyxkenshi"), theirs("m2", "CreedBratton"), theirs("m3", "Free")], {
      difficulty: "HARD",
      ...over,
    });

  it("divides what fell by the people who ran, and keeps what fell beside it", () => {
    // 60 off Limbo, three people, so 20 are yours. The log counted 60 before this, which is three
    // times what that character got.
    const log = buildDropLog([trio()], [pool("pa", [coupons()])], tables);
    const entry = log.entries[0]!;

    expect(entry.quantity).toBe(60);
    expect(entry.yours).toBe(20);
    // Nobody looted the lot, so they are already yours and nobody is named.
    expect(entry.owedBy).toBeNull();
    expect(consolidate(log.entries, ORDER)[0]!.yours).toBe(20);
    expect(consolidate(log.entries, ORDER)[0]!.fell).toBe(60);
  });

  it("divides it by the week it fell in, not by the week the page asked for", () => {
    // The log reads a pool spanning months against ONE roster, and `members` is whichever week the
    // page asked for. Husky ran Limbo as a trio in July and as a duo this week: read against the
    // duo, July's row claims 30 of the 60 for a character who got 20. See ranSeats.
    const all = [mine("m1", "Huskyxkenshi"), theirs("m2", "CreedBratton"), theirs("m3", "Free")];
    const nowADuo = trio({ members: [all[0]!, all[1]!], seats: all });
    const july = coupons({ droppedOn: "2026-07-20", ranThatWeek: ["m1", "m2", "m3"] });

    expect(buildDropLog([nowADuo], [pool("pa", [july])], tables).entries[0]!.yours).toBe(20);
  });

  it("adds up to the runs it folds, which is what a fold means", () => {
    // The one that got past the first cut: the line summed your share while the runs behind the
    // chevron were drawn from what fell, so opening a fold of 40 showed two runs of 60.
    const log = buildDropLog(
      [trio()],
      [pool("pa", [coupons({ id: "l1" }), coupons({ id: "l2", droppedOn: "2026-07-27" })])],
      tables,
    );
    const line = consolidate(log.entries, ORDER)[0]!;

    expect(line.folded).toBe(true);
    expect(line.yours).toBe(line.entries.reduce((sum, e) => sum + e.yours, 0));
    expect(line.yours).toBe(40);
    // And what fell is still there, unmixed with it.
    expect(line.fell).toBe(120);
  });

  it("does not call a share you are already holding work still to do", () => {
    // A piece drop settles through the tranche ledger, never through a sale on its own row, so it
    // is PENDING for ever. Counting that put every coupon drop the account has had in the pool,
    // permanently, on parties whose split came out exactly even.
    const log = buildDropLog([trio()], [pool("pa", [coupons()])], tables);

    expect(log.entries[0]!.status).toBe("PENDING");
    expect(log.totals.pending).toBe(0);
    expect(log.totals.piecesOwed).toBe(0);
    // And the row says so. "In the pool" off the raw status was the message on every coupon drop
    // the account has ever had, for ever, because a piece row never sells.
    expect(dropStatusLabel(log.entries[0]!)).toBe("Yours");
  });

  it("says a coupon somebody else holds in coupons, and never also as a row", () => {
    const log = buildDropLog([trio({ looterMemberId: "m2" })], [pool("pa", [coupons()])], tables);

    // One drop, one fact. Counting it both ways read as two things to do: a single coupon drop
    // showed as "1 in the pool · 30 coupons owed" on the party row.
    expect(log.totals.pending).toBe(0);
    expect(log.totals.piecesOwed).toBe(20);
    // And "in the pool" is not what it is. It is in somebody else's inventory, which the row says.
    expect(dropStatusLabel(log.entries[0]!)).toBe("Owed");
  });

  it("tells a party's own pool what its coupon rows say, and leaves the rest alone", () => {
    // What Party View's panels draw a vestige stack with. Without it the row falls back to its raw
    // status, which is PENDING for ever, so the pool would read "In the pool" under a badge that
    // deliberately does not count it: the same drop said two ways on one line.
    const hammer = drop({ id: "l2", status: "PENDING", soldAt: null, saleAmount: null });
    const log = buildDropLog(
      [trio({ looterMemberId: "m2" })],
      [pool("pa", [coupons({ id: "l1" }), hammer])],
      tables,
    );
    const forParty = pieceStatusByParty(log.entries).get("pa")!;

    expect(forParty.get("l1")).toEqual({ status: "Owed", yours: 20 });
    // Yours out of what fell, which is the pair of numbers the row shows.
    expect(log.entries.find((e) => e.lootId === "l1")!.quantity).toBe(60);
    // An ordinary drop is absent, not given a second reading of a status it already carries.
    expect(forParty.has("l2")).toBe(false);
  });

  it("has nothing to say about a party whose pool holds no coupons", () => {
    const log = buildDropLog([duo()], [pool("pa", [drop()])], tables);

    expect(pieceStatusByParty(log.entries).has("pa")).toBe(false);
  });

  it("gives each party its own coupons-owed figure for the row badge", () => {
    // Off the same entries the Drop Log counts, so a party row and the log cannot disagree about
    // what is owed. A party holding its own coupons is absent rather than zero.
    const owed = buildDropLog([trio({ looterMemberId: "m2" })], [pool("pa", [coupons()])], tables);
    expect(couponsOwedByParty(owed.entries).get("pa")).toBe(20);

    const even = buildDropLog([trio()], [pool("pa", [coupons()])], tables);
    expect(couponsOwedByParty(even.entries).has("pa")).toBe(false);
  });

  it("stops counting a coupon drop once its books are closed", () => {
    // The fourth place this blind spot turned up. `owedBy` is a fact about the party's ARRANGEMENT,
    // `entitled - looted`, fixed when the drop was logged, so the badge said "20 coupons owed" and
    // the row said "Owed" for ever, however completely the tranche ledger had been filled in.
    const parties = [trio({ looterMemberId: "m2" })];
    const pools = [pool("pa", [coupons()])];

    const open = buildDropLog(parties, pools, tables);
    expect(open.totals.piecesOwed).toBe(20);
    expect(couponsOwedByParty(open.entries).get("pa")).toBe(20);
    expect(dropStatusLabel(open.entries[0]!)).toBe("Owed");

    // Closed by the holder who owes it, which is the seat that looted the lot.
    const closed = closedByHolder([
      { holder: holderOf(trio().members[1]!), lootIds: [coupons().id], unpaid: 0 },
    ]).closed;
    const done = buildDropLog(parties, pools, tables, closed);

    expect(done.entries[0]!.closed).toBe(true);
    expect(done.totals.piecesOwed).toBe(0);
    expect(couponsOwedByParty(done.entries).has("pa")).toBe(false);
    expect(dropStatusLabel(done.entries[0]!)).toBe("Settled");
  });

  it("closes it for the holder who owes it, not for anybody else", () => {
    // A settlement is one person's decision, so somebody else's must change nothing here: otherwise
    // closing your books with one partner would retire a debt owed by another.
    const parties = [trio({ looterMemberId: "m2" })];
    const pools = [pool("pa", [coupons()])];
    const stranger = closedByHolder([
      {
        holder: { kind: "PERSON" as const, personId: "p-nobody", characterName: null },
        lootIds: [coupons().id],
        unpaid: 0,
      },
    ]).closed;

    const log = buildDropLog(parties, pools, tables, stranger);
    expect(log.entries[0]!.closed).toBe(false);
    expect(couponsOwedByParty(log.entries).get("pa")).toBe(20);
  });

  it("closes it through the PERSON, whichever of their characters looted it", () => {
    // The fold, one layer out. Chris brought two characters, so his pile is one and closing it
    // against either of them closes the drop. Keyed by character this would have taken two.
    const parties = [trio({ looterMemberId: "m2" })];
    const pools = [pool("pa", [coupons()])];

    for (const seat of [trio().members[1]!, trio().members[2]!]) {
      const closed = closedByHolder([
        { holder: holderOf(seat), lootIds: [coupons().id], unpaid: 0 },
      ]).closed;
      expect(buildDropLog(parties, pools, tables, closed).entries[0]!.closed).toBe(true);
    }
  });

  it("says what a coupon row is, since its raw status is PENDING for ever", () => {
    // The party page's own rows read `statusLabel(loot.status)`, and a piece drop never sells through
    // its own row, so every vestige stack a party had ever dropped said "In the pool" with the full
    // amount beside it. These are the three answers that replace it.
    const own = buildDropLog([trio()], [pool("pa", [coupons()])], tables);
    expect(dropStatusLabel(own.entries[0]!)).toBe("Yours");

    const owed = buildDropLog([trio({ looterMemberId: "m2" })], [pool("pa", [coupons()])], tables);
    expect(dropStatusLabel(owed.entries[0]!)).toBe("Owed");

    const closed = closedByHolder([
      { holder: holderOf(trio().members[1]!), lootIds: [coupons().id], unpaid: 0 },
    ]).closed;
    const done = buildDropLog(
      [trio({ looterMemberId: "m2" })],
      [pool("pa", [coupons()])],
      tables,
      closed,
    );
    expect(dropStatusLabel(done.entries[0]!)).toBe("Settled");
    // And the raw status has not moved under any of them, which is why it could never be the answer.
    for (const log of [own, owed, done]) expect(log.entries[0]!.status).toBe("PENDING");
  });

  it("carries the share, so a pool row can say which number it is showing", () => {
    // "Vestige of Erion Coupon x180 · Settled" read as 180 of mine being settled, when 90 ever were:
    // the count beside the name is what FELL, which is right for a pool, and the status beside it is
    // about my share. The Drop Log counts the same drop as x90 on purpose, so each screen has to say.
    const log = buildDropLog([trio({ looterMemberId: "m2" })], [pool("pa", [coupons()])], tables);
    const entry = log.entries[0]!;

    expect(entry.quantity).toBe(60);
    expect(entry.yours).toBe(20);
    // The two differing is exactly when a pool row needs to say so. Equal means it came out even.
    expect(entry.yours).not.toBe(entry.quantity);
  });

  it("still counts an ordinary drop that has not sold", () => {
    // Nothing here is about pieces: a hammer nobody has sold is work whoever is holding it.
    const hammer = pending({ dropKey: "exceptional-hammer-face", name: "Hammer", quantity: 1 });
    const log = buildDropLog([trio()], [pool("pa", [hammer])], tables);

    expect(log.totals.pending).toBe(1);
    expect(log.totals.piecesOwed).toBe(0);
  });

  it("names who is holding your share when one seat looted the lot", () => {
    const log = buildDropLog([trio({ looterMemberId: "m2" })], [pool("pa", [coupons()])], tables);
    expect(log.entries[0]!.yours).toBe(20);
    expect(log.entries[0]!.owedBy).toBe("CreedBratton");
  });

  it("does not name your own character, because that is you having it already", () => {
    const log = buildDropLog([trio({ looterMemberId: "m1" })], [pool("pa", [coupons()])], tables);
    expect(log.entries[0]!.owedBy).toBeNull();
  });

  it("folds one person's two characters into one share", () => {
    // Both of theirs are Chris, so he takes two thirds and you take one third, not a half each.
    const log = buildDropLog([trio()], [pool("pa", [coupons()])], tables);
    expect(log.entries[0]!.yours).toBe(20);
  });

  it("leaves an ordinary drop's count alone, since it divides as money", () => {
    // A third of a Grindstone is not a number to put on a row.
    const log = buildDropLog([trio()], [pool("pa", [pending({ quantity: 1 })])], tables);
    expect(log.entries[0]!.yours).toBe(1);
    expect(log.entries[0]!.owedBy).toBeNull();
  });

  it("leaves it alone when nobody has said which mode the party runs", () => {
    // Which amount applies is unknown, so the count stands rather than becoming a guess at a share.
    const log = buildDropLog([trio({ difficulty: null })], [pool("pa", [coupons()])], tables);
    expect(log.entries[0]!.yours).toBe(60);
  });
});

describe("foldNames", () => {
  it("names what a fold spans while the list is short enough to read", () => {
    expect(foldNames(["Limbo", "Baldrix"], "bosses")).toBe("Limbo, Baldrix");
    // One boss run twice is one name, not two.
    expect(foldNames(["Limbo", "Limbo"], "bosses")).toBe("Limbo");
  });

  it("counts them instead once there are too many", () => {
    const eight = ["a", "b", "c", "d", "e", "f", "g", "h"];
    expect(foldNames(eight, "bosses")).toBe("8 bosses");
    expect(foldNames(["a", "b", "c", "d"], "characters")).toBe("4 characters");
  });

  it("counts only what it can name", () => {
    // A count of five over a list of two names is a number nobody can check.
    expect(foldNames(["Limbo", null, undefined, "Baldrix", ""], "bosses")).toBe("Limbo, Baldrix");
    expect(foldNames([null, undefined], "bosses")).toBeNull();
    expect(foldNames([], "bosses")).toBeNull();
  });
});

describe("oneBossBehind", () => {
  // Only bossKey is read, so a run is only its boss here.
  const run = (bossKey: string | null) => ({ bossKey }) as DropEntry;

  it("is true when every run came off the same boss", () => {
    // Eleven Kalos runs behind one coupon fold: the line above says Kalos, and each run repeating
    // it says nothing eleven times.
    expect(oneBossBehind([run("kalos-the-guardian"), run("kalos-the-guardian")])).toBe(true);
    expect(oneBossBehind([run("kalos-the-guardian")])).toBe(true);
  });

  it("is false when the fold spans bosses, which is when the name tells them apart", () => {
    expect(oneBossBehind([run("kalos-the-guardian"), run("limbo")])).toBe(false);
    // A boss and a free-text row filed with none are still two different answers.
    expect(oneBossBehind([run("kalos-the-guardian"), run(null)])).toBe(false);
  });

  it("is true when no run has a boss at all, so the date is all there is either way", () => {
    expect(oneBossBehind([run(null), run(null)])).toBe(true);
  });
});
