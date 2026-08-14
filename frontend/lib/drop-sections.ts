// The Drop Log's four stages: what fell, what you sold, what you are owed, and what is done.
//
// One direction only. A drop is logged, its pieces are sold or its item is priced, what that leaves
// owed is settled, and then it is finished and leaves the three worklists for good. The first three
// ask something of the reader; the last asks nothing and only records, which is why a finished row
// belongs in it and nowhere else.
//
// All four are always offered, empty or not. They used to come and go with their contents, which
// had two costs: a tab could vanish from under the reader as they recorded the last thing on it,
// silently moving them somewhere else, and a ledger nobody had ever had anything on was invisible,
// so there was no way to learn it existed. An empty one says so instead.

export type DropSectionKey = "drops" | "sales" | "settlement" | "settled";

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

/** The tabs, which are the same four however little is behind them, and in pipeline order. */
export function dropSections(): DropSection[] {
  return [
    { key: "drops", label: "Drop Ledger" },
    { key: "sales", label: "Sale Ledger" },
    { key: "settlement", label: "Settlement Ledger" },
    { key: "settled", label: "Settled" },
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
