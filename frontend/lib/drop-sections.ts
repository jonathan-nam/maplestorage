// The Drop Log's two halves: what fell, and what it was sold for.
//
// Split out of the page because the tab row has a silent failure mode. The Sale Ledger exists only
// while there is a card behind it, so recording the last tranche can take the tab away underneath
// the reader, and a page left on a section that no longer exists draws nothing at all.

export type DropSectionKey = "drops" | "sales" | "collection";

export type DropSection = { key: DropSectionKey; label: string };

/** What the Sale Ledger would draw, in cards. */
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

/**
 * The tabs to draw, or none.
 *
 * No tabs when there is nothing behind either of the other two: the page is then only the drops, and
 * a lone tab over them is a control that filters nothing. The Drop Ledger is never the empty one,
 * because every card on the other tabs comes off a drop that is in it.
 *
 * `collection` is what OTHERS owe you, which is a different question from what you can sell, so it
 * gets a tab rather than a section: the Sale Ledger is piles you can act on alone, and this is the
 * ones you are waiting on somebody for.
 */
export function dropSections(cards: SaleCards, collection = 0): DropSection[] {
  if (saleCards(cards) === 0 && collection === 0) return [];
  return [
    { key: "drops", label: "Drop Ledger" },
    ...(saleCards(cards) > 0 ? [{ key: "sales" as const, label: "Sale Ledger" }] : []),
    ...(collection > 0 ? [{ key: "collection" as const, label: "Collection Ledger" }] : []),
  ];
}

/** The section to draw: the chosen one while it still exists, else the drops. */
export function shownSection(chosen: DropSectionKey, sections: DropSection[]): DropSectionKey {
  return sections.some((s) => s.key === chosen) ? chosen : "drops";
}
