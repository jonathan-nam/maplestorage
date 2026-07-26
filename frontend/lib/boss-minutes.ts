// How long a run is assumed to take.
//
// Thirty minutes, the same for every boss, on purpose. Nothing in this repo knows how long your
// party takes: a clear is stored as a boolean, and difficulty is deliberately not tracked at all
// (see catalog/bosses.yaml), so one boss key covers a Normal that dies in ninety seconds and a
// Hard that goes to the death counter. A per-boss table would be a column of invented numbers
// dressed as measurements, and the schedule built on it would be confidently wrong.
//
// A flat figure is honestly a placeholder, and reads as one. When a party knows its own pace the
// answer is an input on that party, not a better guess here.
//
// It lives in the frontend rather than catalog/bosses.yaml because that manifest holds game facts,
// and "thirty minutes" is not one. Same reasoning that keeps the Auction House rates in
// drop-split.ts instead of a column.

/** What a run takes when nothing has said otherwise. */
export const DEFAULT_MINUTES = 30;

/**
 * The estimate in force for a boss, given whatever has been overwritten.
 *
 * An override of zero is honoured rather than treated as absent: `overrides[key] || DEFAULT` would
 * quietly ignore it, and zero is a real thing to say about a boss a party walks through.
 */
export function minutesFor(bossKey: string, overrides: Record<string, number> = {}): number {
  const override = overrides[bossKey];
  return override === undefined ? DEFAULT_MINUTES : override;
}
