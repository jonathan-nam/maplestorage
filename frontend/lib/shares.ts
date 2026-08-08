// How much of a pot one seat takes.
//
// A share count is not money and nothing here divides anything: the split is splitDrop's, and these
// counts are only the weights it is given. They exist because a party that carries somebody
// sometimes agrees that whoever carried takes more, and because a drop that can only be traded once
// leaves one member holding the whole sale to hand out.

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

/** A stored count as it is typed: one share is blank, so an even party shows empty boxes. */
export function shareText(shares: number | undefined): string {
  return shares === undefined || shares === 1 ? "" : String(shares);
}

/**
 * What each named seat takes, for a party save.
 *
 * A single share is left out rather than sent as 1. The server reads an absent name as one share,
 * so omitting is how a weight is cleared, and a body of nothing is an evenly-split party.
 *
 * Names come from the roster being saved, and blank rows are dropped: a share cannot be pinned to a
 * seat that has no name yet.
 */
export function sharesBody(
  ownName: string | undefined,
  members: string[],
  entered: { own: string; members: string[] },
): Record<string, number> {
  const typed: [string, string][] = [
    ...(ownName === undefined ? [] : [[ownName, entered.own] as [string, string]]),
    ...members.map((name, i): [string, string] => [name.trim(), entered.members[i] ?? ""]),
  ];

  const body: Record<string, number> = {};
  for (const [name, text] of typed) {
    const count = parseShares(text);
    if (name !== "" && count !== null && count !== 1) body[name] = count;
  }
  return body;
}
