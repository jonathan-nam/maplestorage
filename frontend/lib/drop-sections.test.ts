import { describe, expect, it } from "vitest";
import { dropSections, saleCards, shownSection } from "./drop-sections";

const none = { unanswered: 0, holders: 0, lots: 0 };
const keys = () => dropSections().map((s) => s.key);

describe("how many cards the Sale Ledger holds", () => {
  it("counts every unanswered night as the one card that answers them", () => {
    expect(saleCards({ ...none, unanswered: 4 })).toBe(1);
  });

  it("counts a card per holder and per pile", () => {
    expect(saleCards({ unanswered: 2, holders: 3, lots: 2 })).toBe(6);
  });
});

describe("which sections the page has", () => {
  it("offers all three, whatever is behind them", () => {
    // They used to come and go with their contents, which took a tab out from under the reader as
    // they recorded the last thing on it and hid a ledger nobody had ever had anything on.
    expect(keys()).toEqual(["drops", "sales", "collection"]);
  });

  it("offers the same three when the account is empty", () => {
    expect(saleCards(none)).toBe(0);
    expect(keys()).toEqual(["drops", "sales", "collection"]);
  });
});

describe("which section to draw", () => {
  it("draws the chosen one", () => {
    expect(shownSection("sales", dropSections())).toBe("sales");
    expect(shownSection("collection", dropSections())).toBe("collection");
  });

  // The guard is now against a key that is not a section at all, from a stale cached value rather
  // than from a tab that went away.
  it("falls back to the drops for a key that is not a section", () => {
    expect(shownSection("nonsense" as never, dropSections())).toBe("drops");
  });
});
