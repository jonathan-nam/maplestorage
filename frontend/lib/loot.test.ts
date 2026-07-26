import { describe, expect, it } from "vitest";
import { splitDrop } from "./drop-split";
import { formatDropped, memberFee, splitOf, statusLabel, summarize } from "./loot";
import type { Loot } from "@/types/loot";
import type { PartyMember } from "@/types/party";

const member = (id: string, name: string, mvp = false): PartyMember => ({
  id,
  name,
  characterId: null,
  mvp,
  spriteImgUrl: null,
});

const party = [member("m1", "Rune"), member("m2", "Steve", true), member("m3", "Bob")];

const sold = (over: Partial<Loot> = {}): Loot => ({
  id: "l1",
  dropKey: "grindstone-of-faith",
  customName: null,
  name: "Grindstone of Faith",
  iconUrl: "/drop-icons/grindstone-of-faith.png",
  perMember: null,
  bossKey: "limbo",
  droppedOn: "2026-07-20",
  status: "SOLD",
  saleAmount: 9_500_000_000,
  amountBasis: "LISTED",
  splitMethod: "FAIR",
  sellerMemberId: "m1",
  soldAt: "2026-07-21T10:00:00Z",
  payouts: [
    { memberId: "m2", paid: false, paidAt: null },
    { memberId: "m3", paid: true, paidAt: "2026-07-21T11:00:00Z" },
  ],
  ...over,
});

describe("splitOf", () => {
  it("hands the party's own rates to splitDrop rather than computing anything itself", () => {
    // The check that matters: these figures are splitDrop's, not a second implementation's. An MVP
    // member costs 3% on the payout hop and everyone else 5%, and it is the RECEIVER's rate.
    const loot = sold();
    const expected = splitDrop({
      amount: 9_500_000_000,
      amountIs: "listed",
      sellerFee: memberFee(false),
      memberFees: [memberFee(true), memberFee(false)],
      method: "fair",
    });

    const result = splitOf(loot, party)!;
    expect(result.shares.map((s) => s.pay)).toEqual(expected.members.map((m) => m.pay));
    expect(result.shares.map((s) => s.nets)).toEqual(expected.members.map((m) => m.nets));
    expect(result.seller).toEqual({ memberId: "m1", name: "Rune", keeps: expected.sellerKeeps });
  });

  it("carries who has already been paid onto the shares", () => {
    const result = splitOf(sold(), party)!;
    expect(result.shares.map((s) => [s.name, s.paid])).toEqual([
      ["Steve", false],
      ["Bob", true],
    ]);
  });

  it("reads a RECEIVED amount as what landed, not as a listing", () => {
    // On a received basis the seller's own fee has already been taken, so splitDrop must not take
    // it again. Pinning it here because the two bases differ by exactly one 5% hop.
    const listed = splitOf(sold({ amountBasis: "LISTED" }), party)!;
    const received = splitOf(sold({ amountBasis: "RECEIVED" }), party)!;
    expect(received.split.grossSale).toBeNull();
    expect(received.seller.keeps).toBeGreaterThan(listed.seller.keeps);
  });

  it("refuses a drop that is not sold", () => {
    expect(
      splitOf(sold({ saleAmount: null, sellerMemberId: null, status: "PENDING" }), party),
    ).toBeNull();
  });

  it("refuses rather than guessing when a payout names a seat the party does not have", () => {
    // A seat we cannot read means we cannot read its fee, and a share computed at the wrong rate
    // is the confident wrong number. Better to show nothing.
    const loot = sold({ payouts: [{ memberId: "gone", paid: false, paidAt: null }] });
    expect(splitOf(loot, party)).toBeNull();
  });

  it("refuses when the seller is no longer a seat", () => {
    expect(splitOf(sold({ sellerMemberId: "gone" }), party)).toBeNull();
  });

  it("gives a solo seller nothing to send", () => {
    const loot = sold({ payouts: [] });
    const result = splitOf(loot, party)!;
    expect(result.shares).toEqual([]);
    expect(result.seller.keeps).toBe(result.split.sellerReceives);
  });
});

describe("summarize", () => {
  it("counts what is unsold apart from what is sold and unsettled", () => {
    const loot = [
      sold({ id: "a", status: "PENDING" }),
      sold({ id: "b", status: "SOLD" }),
      sold({ id: "c", status: "SOLD" }),
      sold({ id: "d", status: "PAID_OUT" }),
    ];
    expect(summarize(loot)).toEqual({ pending: 1, awaitingPayout: 2 });
  });
});

describe("statusLabel", () => {
  it("says what each state means for the person reading it", () => {
    expect(statusLabel("PENDING")).toBe("In the pool");
    expect(statusLabel("SOLD")).toBe("Awaiting payout");
    expect(statusLabel("PAID_OUT")).toBe("Settled");
  });
});

describe("formatDropped", () => {
  it("reads the date as written rather than through a timezone", () => {
    expect(formatDropped("2026-07-20")).toBe("20 Jul");
    expect(formatDropped("2026-01-01")).toBe("1 Jan");
  });
});
