import { describe, expect, it } from "vitest";
import { FEE_MVP, FEE_STANDARD, parseMesos, type SplitMethod, splitDrop } from "./drop-split";

const B = 1_000_000_000;

/** Everyone on the same rate, the common case. */
const flat = (salePrice: number, partySize: number, method: SplitMethod, fee = FEE_MVP) =>
  splitDrop({
    salePrice,
    sellerFee: fee,
    memberFees: Array.from({ length: partySize - 1 }, () => fee),
    method,
  });

const nets = (s: ReturnType<typeof splitDrop>) => [s.sellerKeeps, ...s.members.map((m) => m.nets)];
const spread = (s: ReturnType<typeof splitDrop>) => Math.max(...nets(s)) - Math.min(...nets(s));

describe("the fee", () => {
  it("takes the seller's own rate off the sale before anything is divided", () => {
    expect(flat(B, 1, "lazy", FEE_MVP).sellerReceives).toBe(970_000_000);
    expect(flat(B, 1, "lazy", FEE_STANDARD).sellerReceives).toBe(950_000_000);
  });

  it("leaves a solo seller everything they received", () => {
    for (const method of ["lazy", "fair"] as const) {
      const s = flat(B, 1, method);
      expect(s.members).toEqual([]);
      expect(s.sellerKeeps).toBe(970_000_000);
    }
  });
});

describe("a fair split leaves everyone holding the same", () => {
  // The whole point of the mode. If this ever fails the tool is lying to the party.
  it.each([2, 3, 4, 5, 6])("party of %i, all on the same rate", (partySize) => {
    expect(spread(flat(B, partySize, "fair"))).toBeLessThanOrEqual(partySize);
  });

  it.each([2, 3, 4, 5, 6])("party of %i, all on the standard rate", (partySize) => {
    expect(spread(flat(B, partySize, "fair", FEE_STANDARD))).toBeLessThanOrEqual(partySize);
  });

  // The reason rates are per member and not one value for the room.
  it("equalises a party of mixed MVP status", () => {
    const s = splitDrop({
      salePrice: 9_500_000_000,
      sellerFee: FEE_MVP,
      memberFees: [FEE_MVP, FEE_STANDARD, FEE_STANDARD, FEE_MVP, FEE_STANDARD],
      method: "fair",
    });
    expect(spread(s)).toBeLessThanOrEqual(6);
    // A member paying more tax must be SENT more, or they would not land level.
    const [mvp, standard] = s.members;
    expect(standard?.pay).toBeGreaterThan(mvp?.pay ?? 0);
  });

  it("sends more than it keeps, because the transfer is taxed again", () => {
    const s = flat(B, 4, "fair");
    expect(s.members[0]?.pay).toBeGreaterThan(s.sellerKeeps);
  });
});

describe("a lazy split quietly favours the seller", () => {
  it("pays everyone the same gross and so leaves them a fee short", () => {
    const s = flat(B, 4, "lazy");
    expect(s.members[0]?.pay).toBe(242_500_000);
    expect(s.sellerKeeps).toBe(242_500_000);
    expect(s.members[0]?.nets).toBe(235_225_000); // 3% lighter than the seller's own share
  });

  it("shorts a standard-rate member more than an MVP one", () => {
    const s = splitDrop({
      salePrice: B,
      sellerFee: FEE_MVP,
      memberFees: [FEE_MVP, FEE_STANDARD],
      method: "lazy",
    });
    // Same gross to each, so the one taxed harder simply ends up with less.
    expect(s.members[0]?.pay).toBe(s.members[1]?.pay);
    expect(s.members[1]?.nets).toBeLessThan(s.members[0]?.nets ?? 0);
  });
});

describe("nothing is invented and nothing is lost", () => {
  it.each([
    [B, 2],
    [B, 6],
    [123_456_789, 5],
    [7, 3],
  ])("price %i across %i never pays out more than was received", (salePrice, partySize) => {
    for (const method of ["lazy", "fair"] as const) {
      for (const fee of [FEE_MVP, FEE_STANDARD]) {
        const s = flat(salePrice, partySize, method, fee);
        const paidOut = s.members.reduce((sum, m) => sum + m.pay, 0);
        expect(s.sellerKeeps + paidOut).toBe(s.sellerReceives);
        expect(s.sellerKeeps).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("accounts for every meso of the sale price, at mixed rates", () => {
    const s = splitDrop({
      salePrice: B,
      sellerFee: FEE_STANDARD,
      memberFees: [FEE_MVP, FEE_STANDARD, FEE_MVP],
      method: "fair",
    });
    const received = s.members.reduce((sum, m) => sum + m.nets, 0);
    expect(s.sellerKeeps + received + s.totalFee).toBe(B);
  });
});

describe("it refuses rather than guesses", () => {
  it.each([1, 1.5, -0.01, Number.NaN])("rejects a fee of %s", (fee) => {
    expect(() =>
      splitDrop({ salePrice: B, sellerFee: fee, memberFees: [FEE_MVP], method: "fair" }),
    ).toThrow(RangeError);
    expect(() =>
      splitDrop({ salePrice: B, sellerFee: FEE_MVP, memberFees: [fee], method: "fair" }),
    ).toThrow(RangeError);
  });

  it("rejects a negative price", () => {
    expect(() => flat(-1, 4, "fair")).toThrow(RangeError);
  });

  it("handles a price too small to divide without inventing mesos", () => {
    const s = flat(1, 6, "fair");
    expect(s.sellerReceives).toBe(0);
    expect(s.sellerKeeps).toBe(0);
    expect(s.members.every((m) => m.pay === 0)).toBe(true);
  });
});

describe("reading a price the way a player types it", () => {
  it.each([
    ["1b", 1_000_000_000],
    ["9.5b", 9_500_000_000],
    ["970m", 970_000_000],
    ["500k", 500_000],
    ["1,000,000,000", 1_000_000_000],
    [" 1B ", 1_000_000_000],
    ["0", 0],
  ])("reads %s", (input, expected) => {
    expect(parseMesos(input)).toBe(expected);
  });

  it.each(["", "b", "1x", "1.2.3", "abc", "-1", "1b2"])(
    "returns null for %s rather than a guess",
    (input) => {
      expect(parseMesos(input)).toBeNull();
    },
  );
});
