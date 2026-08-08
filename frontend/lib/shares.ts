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
 */
export function parseShares(input: string): number | null {
  const cleaned = input.trim();
  if (cleaned === "") return 1;
  if (!/^\d+$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return value >= 1 && value <= MAX_SHARES ? value : null;
}

/** What to say beside a payout that is not a single share, or empty when it is. */
export function sharesLabel(shares: number): string {
  return shares === 1 ? "" : `${shares} shares`;
}
