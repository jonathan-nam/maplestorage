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
