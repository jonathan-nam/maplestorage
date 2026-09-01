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
export function invitedSummary(counts: { bosses: number; peopleCount: number }): string {
  const parts: string[] = [];
  if (counts.bosses > 0)
    parts.push(`${counts.bosses} ${counts.bosses === 1 ? "party" : "parties"}`);
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
 * The link still worth talking about for one person, or null.
 *
 * Unaccepted and unexpired, newest first. Both conditions are the backend's (see liveInviteFor):
 * an accepted invite is kept as the record of where an account came from and an expired one is
 * refused on redemption, so neither is something the sender can still revoke or a friend can still
 * use. Showing either as live would offer a button that does nothing.
 *
 * The list should hold at most one of these per person, because making a link deletes the unaccepted
 * ones it replaces. Newest-first rather than single(), so a race that left two does not decide which
 * one is shown by which came back first.
 */
export function liveInvite(invites: Invite[], personId: string, now: Date): Invite | null {
  const live = invites
    .filter((i) => i.personId === personId && !i.accepted && new Date(i.expiresAt) > now)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return live[0] ?? null;
}

/**
 * Whole minutes until a link stops working, floored, never below zero.
 *
 * Floored because it is read as "you have this long": rounding 1.6 minutes up to 2 promises most of
 * a minute that is not there. A link inside its last minute reads as 0, which is the honest answer
 * and is also true.
 */
export function minutesUntil(expiresAt: string, now: Date): number {
  const ms = new Date(expiresAt).getTime() - now.getTime();
  return Math.max(0, Math.floor(ms / 60_000));
}
