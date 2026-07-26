import { describe, expect, it } from "vitest";
import { buildDropLog, forCharacter, monthLabel } from "./drop-log";
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
});

const theirs = (id: string, name: string): PartyMember => ({
  id,
  name,
  personId: "p-chris",
  personName: "Chris",
  characterId: null,
  spriteImgUrl: null,
});

const party = (id: string, members: PartyMember[], over: Partial<Party> = {}): Party => ({
  id,
  characterId: members[0]!.characterId!,
  bossKey: "limbo",
  members,
  pendingLoot: 0,
  awaitingPayout: 0,
  settledLoot: 0,
  cleared: null,
  clearedByHand: false,
  createdAt: "2026-07-01T00:00:00Z",
  updatedAt: "2026-07-01T00:00:00Z",
  ...over,
});

const drop = (over: Partial<Loot> = {}): Loot => ({
  id: "l1",
  dropKey: "grindstone-of-faith",
  customName: null,
  name: "Grindstone of Faith",
  iconUrl: null,
  perMember: null,
  bossKey: "limbo",
  droppedOn: "2026-07-20",
  status: "SOLD",
  saleAmount: 10_000_000_000,
  amountBasis: "LISTED",
  splitMethod: "FAIR",
  sellerMemberId: "m1",
  soldAt: "2026-07-21T10:00:00Z",
  payouts: [{ memberId: "m2", paid: false, paidAt: null }],
  ...over,
});

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
    const entry = log.months[0]!.entries[0]!;

    expect(entry.pooled).toBe(expected.split.sellerReceives);
    expect(entry.yourTake).toBe(expected.seller.keeps);
    expect(entry.sellerName).toBe("mechyfechy");
  });

  it("counts your take as what you netted when somebody else sold it", () => {
    const p = duo();
    const loot = drop({
      sellerMemberId: "m2",
      payouts: [{ memberId: "m1", paid: false, paidAt: null }],
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
    const entry = log.months[0]!.entries[0]!;

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
    expect(log.months[0]!.entries[0]!.unreadable).toBe(true);
  });

  it("groups by month, newest first, and subtotals each", () => {
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

    expect(log.months.map((m) => m.key)).toEqual(["2026-07", "2026-06"]);
    expect(log.months[0]!.entries.map((e) => e.droppedOn)).toEqual(["2026-07-20", "2026-07-04"]);
    // Each month's subtotal is its own rows, and together they are the whole.
    expect(log.months[0]!.pooled + log.months[1]!.pooled).toBe(log.totals.pooled);
    expect(log.months[0]!.entries).toHaveLength(2);
  });

  it("skips a pool whose party it cannot see", () => {
    const log = buildDropLog([], [pool("ghost", [drop()])]);
    expect(log.totals.drops).toBe(0);
    expect(log.months).toHaveLength(0);
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
            payouts: [{ memberId: "m4", paid: false, paidAt: null }],
          }),
        ]),
      ],
    );

    const only = forCharacter(log, one.characterId);

    expect(log.totals.drops).toBe(2);
    expect(only.totals.drops).toBe(1);
    expect(only.totals.pooled).toBe(only.months[0]!.entries[0]!.pooled);
    expect(
      only.months.every((m) => m.entries.every((e) => e.characterId === one.characterId)),
    ).toBe(true);
    // Null means every character, unfiltered.
    expect(forCharacter(log, null)).toBe(log);
  });

  it("drops a month that has nothing left in it", () => {
    const one = party("pa", [mine("m1", "mechyfechy"), theirs("m2", "CreedBratton")]);
    const two = party("pb", [mine("m3", "otherchar"), theirs("m4", "CreedBratton")]);
    const log = buildDropLog(
      [one, two],
      [pool("pa", [drop({ id: "l1", droppedOn: "2026-06-01" })]), pool("pb", [drop({ id: "l2" })])],
    );

    expect(log.months).toHaveLength(2);
    expect(forCharacter(log, one.characterId).months.map((m) => m.key)).toEqual(["2026-06"]);
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
