import { describe, expect, it } from "vitest";
import { type Holding, redeemableBySet, redemptionNote } from "./redemption";

// Every case below is a number the app once got wrong, or would get wrong again the moment someone
// "simplified" the counting by summing first. None of them are hypothetical: each was a real
// misreading during development, and each looked exactly like arithmetic.

const ARMOUR = ["Hat", "Top", "Bottom", "Shoulder"]; // Kalos, Kaling, First Adversary, Malefic Star
const ACCESSORY = ["Cape", "Glove", "Shoe"]; // Limbo, Baldrix

const piece = (quantity: number, redeemSlots: string[]): Holding => ({
  quantity,
  redeemThreshold: 10,
  redeemSlots,
});
const potion = (quantity: number): Holding => ({
  quantity,
  redeemThreshold: null,
  redeemSlots: [],
});

const sets = (holdings: Holding[]) => Object.fromEntries(redeemableBySet(holdings));

describe("rule 1. Pieces cannot be pooled across characters", () => {
  it("6 on one character and 4 on another is not a set", () => {
    // The aggregate view used to report this as "10 / 10 toward an Eternal set". It is zero.
    expect(sets([piece(6, ARMOUR), piece(4, ARMOUR)])).toEqual({});
  });

  it("40 pieces spread 4 apiece over 10 characters redeems nothing", () => {
    expect(sets(Array.from({ length: 10 }, () => piece(4, ARMOUR)))).toEqual({});
  });

  it("but 10 on a single character is one", () => {
    expect(sets([piece(10, ARMOUR)])).toEqual({ "Hat / Top / Bottom / Shoulder": 1 });
  });
});

describe("rule 2. Pieces cannot be mixed between tokens", () => {
  it("9 Kalos and 1 Kaling is nine and one, not ten", () => {
    // Same character, same piece-set, same threshold, and still not a set, because the ten must
    // be ten of the SAME token. This is the case most likely to be 'fixed' into a bug.
    expect(sets([piece(9, ARMOUR), piece(1, ARMOUR)])).toEqual({});
  });

  it("10 Kalos and 10 Kaling on one character is two, because each reaches ten alone", () => {
    expect(sets([piece(10, ARMOUR), piece(10, ARMOUR)])).toEqual({
      "Hat / Top / Bottom / Shoulder": 2,
    });
  });
});

describe("rule 3, the two piece-sets do not buy the same thing", () => {
  it("10 armour pieces and 10 accessory pieces is one of each, never two of either", () => {
    expect(sets([piece(10, ARMOUR), piece(10, ACCESSORY)])).toEqual({
      "Hat / Top / Bottom / Shoulder": 1,
      "Cape / Glove / Shoe": 1,
    });
  });

  it("does not merge the sets into a single count", () => {
    const result = redeemableBySet([piece(10, ARMOUR), piece(10, ACCESSORY)]);
    expect(result.size).toBe(2);
    expect([...result.values()].every((n) => n === 1)).toBe(true);
  });
});

describe("consumables have nothing to redeem", () => {
  it("a stack of potions is never a set, however large", () => {
    expect(sets([potion(9999)])).toEqual({});
  });
});

describe("redemptionNote", () => {
  it("a partial stack is progress, not a set", () => {
    expect(redemptionNote(6, 10)).toBe("6 / 10 toward an Eternal set");
  });

  it("counts multiple sets and what is left over", () => {
    expect(redemptionNote(21, 10)).toBe("2 complete sets · 1 / 10 toward the next");
  });

  it("never renders a nonsense fraction like 21 / 10", () => {
    // What it used to do. "21 / 10" is not a fraction of anything.
    expect(redemptionNote(21, 10)).not.toContain("21 / 10");
  });

  it("reads in the singular for exactly one set", () => {
    expect(redemptionNote(10, 10)).toBe("1 complete set · 0 / 10 toward the next");
  });
});
