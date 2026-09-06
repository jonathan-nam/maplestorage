import type { Invite } from "@/types/invite";

/**
 * Where a sign-on link points, and what the join page does with it.
 *
 * Kept out of the components so both ends agree on one path: the page that makes a link and the
 * route that answers it are in different files, and a disagreement between them is a link that
 * 404s only once somebody has already been sent it.
 */
export const JOIN_PATH = "/join";

export function inviteUrl(origin: string, token: string): string {
  return `${origin}${JOIN_PATH}/${encodeURIComponent(token)}`;
}

/**
 * Where Discord sends somebody back to, mid-invite.
 *
 * The same page they were on, token and all. The token is already in the URL they opened, so
 * carrying it through the round trip is a matter of asking to come back to it rather than a cookie
 * to write and then clean up.
 */
export function joinCallbackPath(token: string): string {
  return `${JOIN_PATH}/${encodeURIComponent(token)}`;
}

/**
 * What a link creates, in the fewest words that still name every kind of thing.
 *
 * A count, not a list: the characters are drawn on the page beside this, and the parties and people
 * are a number until they exist. Zero of something is left out rather than said, so "no people"
 * never appears next to two of them.
 */
export function invitedSummary(counts: { parties: number; peopleCount: number }): string {
  const parts: string[] = [];
  if (counts.parties > 0)
    parts.push(`${counts.parties} ${counts.parties === 1 ? "party" : "parties"}`);
  if (counts.peopleCount > 0) {
    parts.push(`${counts.peopleCount} ${counts.peopleCount === 1 ? "person" : "people"}`);
  }
  return parts.join(", ");
}

/** What was left out, said as a count. Empty when nothing was, so nothing is drawn. */
export function omittedSummary(omitted: { length: number }): string {
  if (omitted.length === 0) return "";
  return `${omitted.length} ${omitted.length === 1 ? "party is" : "parties are"} not included.`;
}

/**
 * What is left of a link as m:ss, or null once there is none.
 *
 * Null rather than "0:00", because a dead link and a nearly dead one are different things to say
 * and only one of them should still offer a Copy button. Seconds are floored: 0:01 with nine tenths
 * of a second behind it is a second you do not have.
 */
export function timeLeft(expiresAt: string, now: Date): string | null {
  const seconds = Math.floor((new Date(expiresAt).getTime() - now.getTime()) / 1000);
  if (seconds <= 0) return null;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * How many of a link's parties to name, and how many are left over.
 *
 * A few is enough to recognise a group by, which is the only question this list answers: whether
 * the link was meant for you. Every one of them would be a wall on the first screen anybody sees,
 * and the count already says how many there are.
 */
export const PARTIES_SHOWN = 3;

export function partiesShown<T>(parties: T[]): { shown: T[]; more: number } {
  return {
    shown: parties.slice(0, PARTIES_SHOWN),
    more: Math.max(0, parties.length - PARTIES_SHOWN),
  };
}
