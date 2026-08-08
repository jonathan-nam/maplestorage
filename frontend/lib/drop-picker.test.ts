import { describe, expect, it } from "vitest";
import {
  MAX_QUANTITY,
  OTHER,
  addDropBody,
  dropOptionLabel,
  parseQuantity,
  pickableDrops,
} from "./drop-picker";
import type { BossDrop } from "@/types/drop";

function drop(overrides: Partial<BossDrop> = {}): BossDrop {
  return {
    dropKey: "grindstone",
    name: "Grindstone of Life",
    iconUrl: null,
    perMember: null,
    worlds: null,
    quantity: 1,
    ...overrides,
  };
}

describe("what the picker may offer", () => {
  it("offers an unnarrowed drop in both worlds", () => {
    const table = [drop()];
    expect(pickableDrops(table, "INTERACTIVE")).toHaveLength(1);
    expect(pickableDrops(table, "HEROIC")).toHaveLength(1);
  });

  it("keeps an Interactive-only drop out of a Heroic party", () => {
    // The whole point of the filter: a picker that offers it there is offering to log a drop
    // that cannot happen.
    const table = [drop(), drop({ dropKey: "coupon", worlds: "INTERACTIVE" })];
    expect(pickableDrops(table, "HEROIC").map((d) => d.dropKey)).toEqual(["grindstone"]);
    expect(pickableDrops(table, "INTERACTIVE")).toHaveLength(2);
  });

  it("is empty for a boss with no table, rather than throwing", () => {
    expect(pickableDrops(undefined, "INTERACTIVE")).toEqual([]);
  });
});

describe("how an option reads", () => {
  it("says so when everybody gets one", () => {
    expect(dropOptionLabel(drop({ perMember: "ALWAYS" }), "INTERACTIVE")).toBe(
      "Grindstone of Life (one each)",
    );
  });

  it("asks the world about a HEROIC-only per-member drop", () => {
    const d = drop({ perMember: "HEROIC" });
    expect(dropOptionLabel(d, "HEROIC")).toBe("Grindstone of Life (one each)");
    expect(dropOptionLabel(d, "INTERACTIVE")).toBe("Grindstone of Life");
  });
});

describe("what the picker posts", () => {
  it("refuses an unanswered picker", () => {
    expect(addDropBody("kalos", "", "")).toBeNull();
  });

  it("refuses 'something else' with nothing typed, whitespace included", () => {
    expect(addDropBody("kalos", OTHER, "")).toBeNull();
    expect(addDropBody("kalos", OTHER, "   ")).toBeNull();
  });

  it("sends the drop key, and no custom name beside it", () => {
    // Exactly one name: the server rejects both, and both would leave two answers to what the
    // row is.
    expect(addDropBody("kalos", "grindstone", "ignored")).toEqual({
      bossKey: "kalos",
      dropKey: "grindstone",
      customName: null,
      quantity: 1,
    });
  });

  it("sends a trimmed custom name, and no drop key beside it", () => {
    expect(addDropBody("kalos", OTHER, "  Some Cape  ")).toEqual({
      bossKey: "kalos",
      dropKey: null,
      customName: "Some Cape",
      quantity: 1,
    });
  });

  it("refuses a drop with no boss, however complete the rest of it is", () => {
    // The Drop Log picks the boss, so an empty key there is a question not yet answered. Posting
    // it would file a drop nothing can find: the pool is resolved from the boss.
    expect(addDropBody("", "grindstone", "")).toBeNull();
    expect(addDropBody("", OTHER, "Some Cape")).toBeNull();
  });
});

describe("how many fell", () => {
  it("reads a blank count as one, so a single item takes no typing", () => {
    expect(parseQuantity("")).toBe(1);
    expect(parseQuantity("  ")).toBe(1);
  });

  it("reads a count as typed, commas included", () => {
    expect(parseQuantity("180")).toBe(180);
    expect(parseQuantity("1,080")).toBe(1080);
  });

  it("refuses what it cannot read rather than falling back to one", () => {
    // A count that quietly became 1 would file 180 coupons as a single one, and the sale beside it
    // would look like the price of one.
    for (const bad of ["18O", "-1", "0", "1.5", "abc", String(MAX_QUANTITY + 1)]) {
      expect(parseQuantity(bad)).toBeNull();
    }
  });

  it("carries the count into what the picker posts, and refuses a body it cannot count", () => {
    expect(addDropBody("kalos", "grindstone", "", "180")?.quantity).toBe(180);
    expect(addDropBody("kalos", OTHER, "Some Cape", "6")?.quantity).toBe(6);
    expect(addDropBody("kalos", "grindstone", "", "18O")).toBeNull();
  });
});
