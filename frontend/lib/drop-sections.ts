// The Drop Log's two halves: what fell, and what it was sold for.
//
// Split out of the page because the tab row has a silent failure mode. The Sale Ledger exists only
// while there is a card behind it, so recording the last tranche can take the tab away underneath
// the reader, and a page left on a section that no longer exists draws nothing at all.

export type DropSectionKey = "drops" | "sales";

export type DropSection = { key: DropSectionKey; label: string };

/** What the Sale Ledger would draw, in cards. */
export type SaleCards = {
  /**
   * Weeks that dropped a coupon, which the week sheet steps through. One card holds all of them.
   *
   * Counted like the others even though it asks nothing: it is where a night's roster is said, and
   * a pile of coupons nobody can split yet is exactly when somebody needs it.
   */
  runs: number;
  /** Nights nobody has said the stack arrangement for. One card holds all of them. */
  unanswered: number;
  /** One card per person holding a pile of coupons. */
  holders: number;
  /** One card per pile of an interchangeable drop waiting to be priced. */
  lots: number;
};

export function saleCards({ runs, unanswered, holders, lots }: SaleCards): number {
  return (runs > 0 ? 1 : 0) + (unanswered > 0 ? 1 : 0) + holders + lots;
}

/**
 * The tabs to draw, or none.
 *
 * No tabs when there is nothing to sell: the page is then only the drops, and a lone tab over them
 * is a control that filters nothing. The Drop Ledger is never the empty one, because every sale
 * card comes off a drop that is in it.
 */
export function dropSections(cards: SaleCards): DropSection[] {
  if (saleCards(cards) === 0) return [];
  return [
    { key: "drops", label: "Drop Ledger" },
    { key: "sales", label: "Sale Ledger" },
  ];
}

/** The section to draw: the chosen one while it still exists, else the drops. */
export function shownSection(chosen: DropSectionKey, sections: DropSection[]): DropSectionKey {
  return sections.some((s) => s.key === chosen) ? chosen : "drops";
}
