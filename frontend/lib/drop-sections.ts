// The Drop Log's three ledgers: what fell, what you sold, and what you are owed.
//
// All three are always offered, empty or not. They used to come and go with their contents, which
// had two costs: a tab could vanish from under the reader as they recorded the last thing on it,
// silently moving them somewhere else, and a ledger nobody had ever had anything on was invisible,
// so there was no way to learn it existed. An empty one says so instead.

export type DropSectionKey = "drops" | "sales" | "collection";

export type DropSection = { key: DropSectionKey; label: string };

/** What the Sale Ledger would draw, in cards. Zero is what puts the empty line on screen. */
export type SaleCards = {
  /** Nights nobody has said the stack arrangement for. One card holds all of them. */
  unanswered: number;
  /** One card per person holding a pile of coupons. */
  holders: number;
  /** One card per pile of an interchangeable drop waiting to be priced. */
  lots: number;
};

export function saleCards({ unanswered, holders, lots }: SaleCards): number {
  return (unanswered > 0 ? 1 : 0) + holders + lots;
}

/** The tabs, which are the same three however little is behind them. */
export function dropSections(): DropSection[] {
  return [
    { key: "drops", label: "Drop Ledger" },
    { key: "sales", label: "Sale Ledger" },
    { key: "collection", label: "Collection Ledger" },
  ];
}

/**
 * The section to draw: the chosen one, since all three always exist.
 *
 * Kept as a function rather than read straight from state because it is the guard against a key
 * that is not a section at all, from an old cached value or a hand-edited one.
 */
export function shownSection(chosen: DropSectionKey, sections: DropSection[]): DropSectionKey {
  return sections.some((s) => s.key === chosen) ? chosen : "drops";
}
