// Redemption, and the three separate ways it can be got wrong.
//
//   1. Pieces cannot be POOLED ACROSS CHARACTERS. Six on one and four on another is not a set; it
//      is two characters who are both short.
//   2. Pieces cannot be MIXED BETWEEN TOKENS. Nine Kalos and one Kaling is not ten pieces, it is
//      nine and one. You need ten of the SAME token.
//   3. The two piece-SETS do not buy the same thing. Kalos / Kaling / First Adversary / Malefic
//      Star pieces make a Hat, Top, Bottom or Shoulder; Limbo and Baldrix pieces make a Cape,
//      Glove or Shoe. Ten of each is one armour and one accessory, never two of either.
//
// Each produces a plausible, confident, WRONG number, the only kind of failure this app really
// has, and each of them looks like arithmetic, which is what makes them so easy to reintroduce.
//
// So they live here, as pure functions, and redemption.test.ts holds them to it. The counting used
// to be written inline in the search component, where it could not be tested at all.

/** One character's holding of one token. */
export type Holding = {
  quantity: number;
  /** Null for a consumable: there is nothing to redeem. */
  redeemThreshold: number | null;
  /** Which Eternal pieces this token buys. Empty for a consumable. */
  redeemSlots: string[];
};

/** A piece-set, named from what it actually buys, so the label cannot drift from the data. */
export function slotSetName(slots: string[]): string {
  return slots.join(" / ");
}

// How close ONE character is to an Eternal set.
//
// Takes a single character's holding of a single token. There is deliberately no variant that
// accepts a total: a total has no progress to report, and offering one would invite rules 1 and 2
// straight back in.
//
// It also has to handle more than one set. 21 pieces was being rendered as "21 / 10", which is not
// a fraction of anything.
export function redemptionNote(quantity: number, threshold: number): string {
  const sets = Math.floor(quantity / threshold);
  const towards = quantity % threshold;
  if (sets === 0) return `${towards} / ${threshold} toward an Eternal set`;
  return `${sets} complete ${sets === 1 ? "set" : "sets"} · ${towards} / ${threshold} toward the next`;
}

// What can be redeemed RIGHT NOW, keyed by piece-set.
//
// `holdings` is every (character, token) pair in scope, flattened deliberately, the caller must
// NOT pre-sum anything. Each holding is divided by its OWN threshold and only then added up, which
// enforces rules 1 and 2 in a single stroke: a holding belongs to one character and one token, so
// there is nowhere for a total to sneak in. Rule 3 is the keying.
export function redeemableBySet(holdings: Holding[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const h of holdings) {
    if (!h.redeemThreshold || h.redeemSlots.length === 0) continue;
    const sets = Math.floor(h.quantity / h.redeemThreshold);
    if (sets === 0) continue;
    const set = slotSetName(h.redeemSlots);
    out.set(set, (out.get(set) ?? 0) + sets);
  }
  return out;
}
