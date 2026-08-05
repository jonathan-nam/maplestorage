import { describe, expect, it } from "vitest";
import { OTHER, addDropBody, dropOptionLabel, pickableDrops } from "./drop-picker";
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
    });
  });

  it("sends a trimmed custom name, and no drop key beside it", () => {
    expect(addDropBody("kalos", OTHER, "  Some Cape  ")).toEqual({
      bossKey: "kalos",
      dropKey: null,
      customName: "Some Cape",
    });
  });

  it("refuses a drop with no boss, however complete the rest of it is", () => {
    // The Drop Log picks the boss, so an empty key there is a question not yet answered. Posting
    // it would file a drop nothing can find: the pool is resolved from the boss.
    expect(addDropBody("", "grindstone", "")).toBeNull();
    expect(addDropBody("", OTHER, "Some Cape")).toBeNull();
  });
});
