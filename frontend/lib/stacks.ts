// What each seat is entitled to, in STACKS.
//
// A stack is what somebody bends down for, so it is the unit a party actually agrees in: "you take
// four and I take two", not "you take twice what I take". The two are the same statement only while
// the stacks divide by the ratio, and the ratio is the one that goes quiet when they do not: a duo on
// three stacks is 1.5 each, which no whole-number ratio of stacks can say.
//
// HALVES are the integer here. Every figure in this file is a count of half-stacks, so nothing
// downstream has to hold 1.5 and no float reaches the database. Halves are enough by construction:
// the only division a stack ever needs is between two people who cannot split it, and a party bigger
// than the stack count is a party the catalog says cannot happen (bundles equal the boss's max party).
//
// What is STORED is still party_member.shares, a ratio, reduced to its lowest terms. That is lossless
// for an entitlement that adds up to the stacks that fell, which is the only kind this file lets you
// save: stacks = bundles * shares / total, exactly. Storing the halves themselves would work too, and
// would leak the encoding into the money side, where a 4:2 party's payout row would read "8 shares".

/** The most stacks one seat may be given, in halves. No boss drops more than six. */
export const MAX_STACK_HALVES = 24;

/**
 * A stack entitlement as typed, in halves: "1.5" is 3, "2" is 4. Null when it is not an answer.
 *
 * Null rather than a fallback, the same rule parseShares and parseQuantity hold to: a "1.5" that
 * quietly reads as 1 hands somebody half a stack less than the party agreed, every week, silently.
 *
 * Blank is null too, and that is the difference from parseShares. A blank RATIO meant one share,
 * because a ratio is about proportion and one is the neutral answer. A blank STACK count is not an
 * answer at all: the boxes have to add up to what fell, and treating an empty one as a stack would
 * put a number nobody typed into that sum.
 *
 * Zero is a real answer: the seat that agreed to take none.
 */
export function parseStacks(input: string): number | null {
  const cleaned = input.trim();
  if (cleaned === "") return null;
  // A leading or trailing dot is accepted (".5", "2."), since both are what a half gets typed as.
  if (!/^\d*\.?\d*$/.test(cleaned) || cleaned === ".") return null;
  const halves = Number(cleaned) * 2;
  if (!Number.isInteger(halves)) return null;
  return halves >= 0 && halves <= MAX_STACK_HALVES ? halves : null;
}

/** Halves back as somebody would type them: 3 is "1.5", 4 is "2". */
export function formatStacks(halves: number): string {
  return halves % 2 === 0 ? String(halves / 2) : String(halves / 2);
}

/**
 * Whether these entitlements are exactly the stacks that fell.
 *
 * The refusal this file exists for. Two stacks each on a boss that drops three is a deal that cannot
 * happen, and the old ratio could not express it at all, so it went in as 1:1 and quietly entitled
 * everybody to 1.5. Under-subscription is refused for the same reason: stacks nobody is entitled to
 * are stacks the ledger cannot say who owes.
 */
export function stacksAddUp(halves: number[], bundles: number): boolean {
  return halves.reduce((sum, n) => sum + n, 0) === bundles * 2;
}

/**
 * The ratio to store for these entitlements, in lowest terms.
 *
 * Lossless while they add up, which is the only case this is called in: the stacks come back out as
 * `bundles * shares / total`. Lowest terms so the number that reaches the money side is the one a
 * human would have written, since the same column weights an item's payout: 4 stacks against 2 is
 * "2 shares" on that row, not "8".
 */
export function sharesFromStacks(halves: number[]): number[] {
  const divisor = halves.reduce((a, b) => gcd(a, b), 0);
  return divisor > 1 ? halves.map((n) => n / divisor) : halves;
}

/**
 * What each seat's ratio comes to in stacks, in halves, or null where it cannot be said exactly.
 *
 * Null when a seat's share does not land on a whole half-stack. That is a deal the party cannot have
 * made, and the honest answer is to say so rather than to round: a quarter of a stack is not a thing
 * anybody can pick up.
 */
export function stacksFromShares(shares: number[], bundles: number): number[] | null {
  const total = shares.reduce((sum, n) => sum + n, 0);
  if (total <= 0) return null;
  const halves = shares.map((share) => (bundles * 2 * share) / total);
  return halves.every(Number.isInteger) ? halves : null;
}

/**
 * The stacks to open the boxes with, in halves, as even as the stacks allow.
 *
 * Not a saved answer: it is where an unanswered config starts, so the ordinary party agrees to it by
 * pressing Save. The remainder goes to the earliest seats, which is arbitrary and has to be, and is
 * why it is offered rather than written.
 */
export function evenStacks(bundles: number, seats: number): number[] {
  if (seats <= 0) return [];
  const each = Math.floor((bundles * 2) / seats);
  let left = bundles * 2 - each * seats;
  return Array.from({ length: seats }, () => {
    const extra = left > 0 ? 1 : 0;
    left -= extra;
    return each + extra;
  });
}

/**
 * A set of typed entitlements as one comparable string, for telling edited from saved.
 *
 * Every box, unlike sharesKey, which dropped the ones reading "1": a blank ratio meant one share, so
 * omitting it changed nothing. A STACK count has no neutral value, and every box has to add up, so
 * dropping any of them would call an edited deal unedited.
 */
export function stacksKey(stacks: Record<string, string>): string {
  return Object.entries(stacks)
    .map(([name, value]) => `${name}=${value.trim()}`)
    .sort()
    .join(",");
}

/** The typed entitlements added up, in halves, with anything unreadable counting as nothing. */
export function sumOfStacks(halves: (number | null)[]): number {
  return halves.reduce<number>((sum, n) => sum + (n ?? 0), 0);
}

/** What a stack entitlement comes to in coupons, for the count beside the box. */
export function couponsOf(halves: number, total: number, bundles: number): number {
  return (total * halves) / (bundles * 2);
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}
