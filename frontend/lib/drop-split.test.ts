import { describe, expect, it } from "vitest";
import { parseMesos, type SplitMethod, splitDrop } from "./drop-split";

const split = (salePrice: number, partySize: number, method: SplitMethod) =>
  splitDrop({ salePrice, partySize, method });

const B = 1_000_000_000;

describe("the fee", () => {
  it("takes 3% of the sale before anything is divided", () => {
    expect(split(B, 1, "lazy").sellerReceives).toBe(970_000_000);
  });

  it("leaves a solo seller everything they received", () => {
    for (const method of ["lazy", "fair"] as const) {
      const s = split(B, 1, method);
      expect(s.payEach).toBe(0);
      expect(s.sellerKeeps).toBe(970_000_000);
    }
  });
});

describe("a fair split leaves everyone holding the same", () => {
  // The whole point of the mode. If this ever fails the tool is lying to the party.
  it.each([2, 3, 4, 5, 6])("party of %i", (partySize) => {
    const s = split(B, partySize, "fair");
    expect(Math.abs(s.eachNets - s.sellerKeeps)).toBeLessThanOrEqual(partySize);
  });

  it("sends more than it keeps, because the transfer is taxed again", () => {
    const s = split(B, 4, "fair");
    expect(s.payEach).toBeGreaterThan(s.sellerKeeps);
  });
});

describe("a lazy split quietly favours the seller", () => {
  it("pays everyone the same gross and so leaves them 3% short", () => {
    const s = split(B, 4, "lazy");
    expect(s.payEach).toBe(242_500_000);
    expect(s.sellerKeeps).toBe(242_500_000);
    expect(s.eachNets).toBe(235_225_000); // 3% lighter than the seller's own share
  });

  it("shorts every member by the fee on their own share", () => {
    // The gap is 3% of a share, plus whatever rounding dust the seller absorbed.
    for (const partySize of [2, 3, 6]) {
      const s = split(B, partySize, "lazy");
      const gap = s.sellerKeeps - s.eachNets;
      expect(gap).toBeGreaterThanOrEqual(Math.floor(s.payEach * 0.03));
      expect(gap).toBeLessThanOrEqual(Math.floor(s.payEach * 0.03) + partySize);
    }
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
      const s = split(salePrice, partySize, method);
      expect(s.sellerKeeps + (partySize - 1) * s.payEach).toBe(s.sellerReceives);
      expect(s.sellerKeeps).toBeGreaterThanOrEqual(0);
    }
  });

  it("accounts for every meso of the sale price", () => {
    const s = split(B, 5, "fair");
    expect(s.sellerKeeps + 4 * s.eachNets + s.totalFee).toBe(B);
  });
});

describe("it refuses rather than guesses", () => {
  it.each([0, -1, 2.5, Number.NaN])("rejects a party size of %s", (partySize) => {
    expect(() => split(B, partySize, "fair")).toThrow(RangeError);
  });

  it("rejects a negative price", () => {
    expect(() => split(-1, 4, "fair")).toThrow(RangeError);
  });

  it("handles a price too small to divide without inventing mesos", () => {
    const s = split(1, 6, "fair");
    expect(s.sellerReceives).toBe(0);
    expect(s.payEach).toBe(0);
    expect(s.sellerKeeps).toBe(0);
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
