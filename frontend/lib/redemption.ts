// Redemption, and the three separate ways it can be got wrong.
//
//   1. Pieces cannot be POOLED ACROSS CHARACTERS. Six on one and four on another is not a set; it
//      is two characters who are both short.
//   2. Pieces cannot be MIXED BETWEEN TOKENS. Nine Kalos and one Kaling is not ten pieces, it is
//      nine and one. You need ten of the SAME token. That is why every count below divides by the
//      threshold per ITEM and never sums first -- summing first is the bug, and it looks like
//      arithmetic.
//   3. The two piece-SETS do not buy the same thing. Kalos / Kaling / First Adversary / Malefic
//      Star pieces make a Hat, Top, Bottom or Shoulder; Limbo and Baldrix pieces make a Cape,
//      Glove or Shoe. Ten of each is one armour and one accessory, never two of either.
//
// Each of these produces a plausible, confident, wrong number, which is the only kind of failure
// this app really has.
//
// How close ONE character is to an Eternal set.
//
// The threshold is per character and cannot be pooled: ten pieces on one character is a set, and
// six on one plus four on another is two characters who are both short. So this only ever takes a
// single character's holding -- there is deliberately no variant that accepts a total, because a
// total has no progress to report and offering one would invite exactly the bug it is here to
// prevent. The aggregate view counts complete sets per character and then adds THOSE up.
//
// It also has to handle more than one set. A character with 21 pieces was being shown "21 / 10",
// which is not a fraction of anything.
export function redemptionNote(quantity: number, threshold: number): string {
  const sets = Math.floor(quantity / threshold);
  const towards = quantity % threshold;
  const next = `${towards} / ${threshold} toward the next`;
  if (sets === 0) return `${towards} / ${threshold} toward an Eternal set`;
  return `${sets} complete ${sets === 1 ? "set" : "sets"} · ${next}`;
}

// The two piece-sets do not overlap.
//
// Kalos / Kaling / First Adversary / Malefic Star pieces buy a Hat, Top, Bottom or Shoulder.
// Limbo and Baldrix pieces buy a Cape, Glove or Shoe. So "20 pieces, 2 sets" is a lie the moment
// they are not the same KIND of piece: ten of each is one armour and one accessory, and there is
// no combination of them that makes two armours.
//
// Named from what the pieces actually buy rather than invented, so the label cannot drift away
// from the data.
export function slotSetName(slots: string[]): string {
  if (slots.length === 0) return "";
  return slots.join(" / ");
}
