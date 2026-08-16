// Raising and lowering a count by holding a button, and what "accelerated" actually means.
//
// A count is ABSOLUTE on the wire (see CharacterTokenWrites.kt), so what a step produces is a new
// total rather than a delta to apply. That is what makes holding safe: the figure sent is whatever
// the number reads when you let go, and a dropped repeat costs a click rather than a wrong total.

/** The most anybody can hold of one item. Mirrors MAX_QUANTITY in CharacterTokenWrites.kt. */
export const MAX_COUNT = 1_000_000;

/**
 * How the hold speeds up, as (held for at least, step, wait until the next one).
 *
 * Two things accelerate and they are deliberately staggered. The WAIT shortens first, so a short
 * hold still moves one at a time and lands exactly where you meant. Only once it is plain that
 * somebody is holding on purpose does the STEP grow, because a number that starts jumping five at a
 * time immediately is one you cannot land on 7 with.
 *
 * The first row is the click itself: one, and a long pause before anything repeats, so a plain
 * click never turns into two.
 */
const SCHEDULE: readonly { after: number; step: number; wait: number }[] = [
  { after: 0, step: 1, wait: 450 },
  { after: 450, step: 1, wait: 160 },
  { after: 1200, step: 1, wait: 70 },
  { after: 3000, step: 5, wait: 70 },
  { after: 6000, step: 25, wait: 70 },
];

/** What one repeat is worth after holding this long, and how long until the next. */
export function stepFor(heldMs: number): { step: number; wait: number } {
  let chosen = SCHEDULE[0]!;
  for (const rung of SCHEDULE) {
    if (heldMs >= rung.after) chosen = rung;
  }
  return { step: chosen.step, wait: chosen.wait };
}

/**
 * A count kept inside what anybody can hold.
 *
 * Clamped rather than refused: the button cannot express "minus one from zero", so holding minus on
 * an empty slot should stop at nothing rather than run negative and refuse to save at the end of it.
 */
export function clampCount(n: number): number {
  // Only NaN, and only because there is nothing better to answer. A blanket !isFinite guard sent
  // Infinity to 0, and 0 on this path CLEARS the item: the destructive direction, chosen for the
  // one input that cannot occur. Steps are finite integers added to a finite count.
  if (Number.isNaN(n)) return 0;
  return Math.min(MAX_COUNT, Math.max(0, Math.round(n)));
}

/**
 * A typed count as a number, or null when it is not an answer.
 *
 * Blank is null rather than zero, and the distinction matters: a box somebody is halfway through
 * clearing reads blank for a keystroke, and writing a zero there would delete the row out from
 * under them. Nothing is written until it reads as a number.
 */
export function parseCount(input: string): number | null {
  const cleaned = input.trim();
  if (cleaned === "" || !/^\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return n >= 0 && n <= MAX_COUNT ? n : null;
}

/**
 * How long to wait after the last press before writing.
 *
 * Long enough that a hold is one write rather than forty, short enough that letting go feels like
 * it saved. What is written is the total the number ended on, so a flush cannot land a figure
 * nobody saw.
 */
export const SAVE_AFTER_MS = 600;
