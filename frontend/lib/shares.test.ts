import { describe, expect, it } from "vitest";
import { MAX_SHARES, parseShares, sharesLabel } from "./shares";

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
});
