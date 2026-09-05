// How much of a pot one seat takes.
//
// A share count is not money and nothing here divides anything: the split is splitDrop's, and these
// counts are only the weights it is given. They exist for the nights that do not divide: a party
// normally loots an equal number of bundles each and records nothing, so what reaches a pool is the
// remainder one member took, or a carry the party agreed takes more than a share.

/** The most one seat may take, matching the column's own CHECK and the backend's refusal. */
export const MAX_SHARES = 99;

/**
 * A share count as typed: blank is one, and anything unreadable is null.
 *
 * Null rather than a fallback, for the reason parseQuantity gives. A "2" that fails to read and
 * quietly becomes 1 pays somebody half of what the party agreed.
 *
 * Zero is a real answer: a seat that takes nothing, because the party agreed one member keeps the
 * drops. Blank is still ONE, so the box being empty never means somebody has been cut out. See V44.
 */
export function parseShares(input: string): number | null {
  const cleaned = input.trim();
  if (cleaned === "") return 1;
  if (!/^\d+$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return value >= 0 && value <= MAX_SHARES ? value : null;
}

/**
 * A set of typed share counts as one comparable string, for telling edited from saved.
 *
 * Blank and "1" are the same answer, so both drop out: typing 1 into a box that was empty has not
 * changed the split, and a Save button lighting up for it would be offering to write nothing.
 */
export function sharesKey(shares: Record<string, string>): string {
  return Object.entries(shares)
    .filter(([, value]) => value.trim() !== "" && value.trim() !== "1")
    .map(([name, value]) => `${name}=${value.trim()}`)
    .sort()
    .join(",");
}

/** What to say beside a payout that is not a single share, or empty when it is. */
export function sharesLabel(shares: number): string {
  return shares === 1 ? "" : `${shares} shares`;
}

/**
 * What each share count comes to as a percentage of the pot, as strings ready to render.
 *
 * Each is its own exact share, NOT a whole number of percent chosen so the column adds to 100.
 * Largest remainder did that, and it read three even seats as 34/33/33: a split the party agreed
 * evenly, on screen as one seat taking more. The money never worked that way (splitDrop divides by
 * the counts and the seller absorbs the dust), so the label was the only thing saying otherwise.
 *
 * Two decimals, trailing zeros dropped, so 4 and 1 stay 80 and 20 and three 1s read 33.33 each.
 * Equal counts always read equal, which is the one thing this label has to get right.
 */
export function sharePercents(weights: number[]): string[] {
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (total <= 0) return weights.map(() => "0");
  return weights.map((w) => String(Number(((100 * w) / total).toFixed(2))));
}
