import { describe, expect, it } from "vitest";
import { dropSections, saleCards, shownSection } from "./drop-sections";

const none = { unanswered: 0, holders: 0, lots: 0 };
const keys = (cards: Parameters<typeof dropSections>[0], collection = 0) =>
  dropSections(cards, collection).map((s) => s.key);

describe("how many cards the Sale Ledger holds", () => {
  it("counts every unanswered night as the one card that answers them", () => {
    expect(saleCards({ ...none, unanswered: 4 })).toBe(1);
  });

  it("counts a card per holder and per pile", () => {
    expect(saleCards({ unanswered: 2, holders: 3, lots: 2 })).toBe(6);
  });
});

describe("which sections the page has", () => {
  it("offers none when there is nothing to sell", () => {
    expect(keys(none)).toEqual([]);
  });

  it("offers both once any one card exists", () => {
    expect(keys({ ...none, unanswered: 1 })).toEqual(["drops", "sales"]);
    expect(keys({ ...none, holders: 1 })).toEqual(["drops", "sales"]);
    expect(keys({ ...none, lots: 1 })).toEqual(["drops", "sales"]);
  });

  it("offers the Collection Ledger only where somebody owes you", () => {
    expect(keys(none, 1)).toEqual(["drops", "collection"]);
    expect(keys({ ...none, holders: 1 }, 2)).toEqual(["drops", "sales", "collection"]);
  });

  it("drops the Sale Ledger when nothing on it is yours to sell", () => {
    // A tab over no cards is a control that filters nothing, which is why the page had none at all
    // before either half existed. The same rule now applies to each half separately.
    expect(keys(none, 3)).not.toContain("sales");
  });
});

describe("which section to draw", () => {
  it("draws the chosen one", () => {
    expect(shownSection("sales", dropSections({ ...none, holders: 1 }))).toBe("sales");
  });

  // The reason this lives here: recording the last tranche empties the Sale Ledger, and the tab the
  // reader is standing on goes with it. Left as "sales", the page would draw nothing.
  it("falls back to the drops when the Sale Ledger empties out underneath it", () => {
    expect(shownSection("sales", dropSections(none))).toBe("drops");
  });
});
