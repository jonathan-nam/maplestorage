import { describe, expect, it } from "vitest";
import { MAX_SHARES, parseShares, shareText, sharesBody, sharesLabel } from "./shares";

describe("a share count as typed", () => {
  it("reads a blank as one, so an even party is a row of empty boxes", () => {
    expect(parseShares("")).toBe(1);
    expect(parseShares("  ")).toBe(1);
  });

  it("reads a count", () => {
    expect(parseShares("2")).toBe(2);
    expect(parseShares(String(MAX_SHARES))).toBe(MAX_SHARES);
  });

  it("refuses what it cannot read rather than falling back to one", () => {
    // The failure this guards: a "2" that quietly becomes 1 pays somebody half of what the party
    // agreed, and every figure on the row still looks ordinary.
    for (const bad of ["0", "-1", "1.5", "two", "1e2", String(MAX_SHARES + 1)]) {
      expect(parseShares(bad)).toBeNull();
    }
  });

  it("says nothing beside a single share, and says the count beside any other", () => {
    expect(sharesLabel(1)).toBe("");
    expect(sharesLabel(3)).toBe("3 shares");
  });

  it("shows a single share as blank, coming back the other way", () => {
    expect(shareText(1)).toBe("");
    expect(shareText(undefined)).toBe("");
    expect(shareText(2)).toBe("2");
  });
});

describe("what a party save sends", () => {
  const entered = (own: string, members: string[]) => ({ own, members });

  it("sends nothing at all for an evenly split party", () => {
    expect(sharesBody("Rune", ["Steve", "Bob"], entered("", ["", ""]))).toEqual({});
  });

  it("names only the seats taking more than one", () => {
    expect(sharesBody("Rune", ["Steve", "Bob"], entered("2", ["3", ""]))).toEqual({
      Rune: 2,
      Steve: 3,
    });
  });

  it("leaves a weight off rather than sending 1, which is how one is cleared", () => {
    expect(sharesBody("Rune", ["Steve"], entered("1", ["1"]))).toEqual({});
  });

  it("drops a row with no name, which has no seat to pin a share to", () => {
    expect(sharesBody("Rune", ["", "Bob"], entered("", ["4", "2"]))).toEqual({ Bob: 2 });
  });

  it("trims a name, so a share lands on the seat the roster will write", () => {
    expect(sharesBody("Rune", ["  Steve  "], entered("", ["2"]))).toEqual({ Steve: 2 });
  });

  it("has nothing to say about your own seat when the week dropped you", () => {
    expect(sharesBody(undefined, ["Steve"], entered("5", ["2"]))).toEqual({ Steve: 2 });
  });
});
