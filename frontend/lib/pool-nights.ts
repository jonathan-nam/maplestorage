// The pool, split into the nights it was actually logged on.
//
// A config is one row per (character, boss), and a one-off takes over the row that pair already has
// rather than making a second one, so a single pool spans every arrangement that character has ever
// run the boss with. Drawing it whole under the config's CURRENT mode and roster stated a Chaos
// night had produced Extreme coupons, on nights run by three people no longer in the party.
//
// The rows were never wrong and the split was never wrong: ranSeats already divides each drop by
// who ran ITS week. What was wrong was the one heading over all of them.

import { formatWeekStart } from "./boss-clears";
import { difficultyLabel } from "./boss-difficulty";
import { ranSeats } from "./vestige-ledger";
import type { Loot } from "@/types/loot";
import type { Party, PartyMember } from "@/types/party";

export type PoolNight = {
  /** The reset week these fell in. The group's identity, and what orders it. */
  weekStart: string;
  /**
   * The mode they fell at, or null.
   *
   * Null covers two silences and deliberately does not tell them apart on screen: a row from before
   * V69 carrying no mode, and a week whose rows DISAGREE about it. Naming one of two modes would be
   * the guess this refuses to make, and an unheaded night is the honest version of not knowing.
   */
  difficulty: string | null;
  /** Who ran it, off the drops' own week roster rather than the party as it stands. See ranSeats. */
  members: PartyMember[];
  loot: Loot[];
};

/** The one mode this night's rows agree on, or null where they are silent or disagree. */
function oneMode(rows: Loot[]): string | null {
  const said = new Set(rows.map((row) => row.difficulty).filter((d): d is string => d !== null));
  return said.size === 1 ? [...said][0]! : null;
}

/**
 * The pool as nights, newest first.
 *
 * Keyed on weekStart, which is the server's own Thursday and already stamped on every row, so this
 * is a comparison and never a date calculation. A boss is cleared once a period, so one week is one
 * night: that is what makes the week the right grain here rather than the mode or the roster, which
 * a single night can hold only one of anyway.
 *
 * Rows keep the order they arrived in, which the server sorted newest first.
 */
export function poolNights(loot: Loot[], party: Party): PoolNight[] {
  const byWeek = new Map<string, Loot[]>();
  for (const row of loot) {
    const rows = byWeek.get(row.weekStart);
    if (rows) rows.push(row);
    else byWeek.set(row.weekStart, [row]);
  }

  return [...byWeek.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([weekStart, rows]) => ({
      weekStart,
      difficulty: oneMode(rows),
      // Any row of the night answers it: they share a week, so they share its roster.
      members: ranSeats(rows[0]!, party),
      loot: rows,
    }));
}

/**
 * What heads a night: when it was, the mode, and who ran it.
 *
 * Facts in the order that answers "which night is this", and a silence is left out rather than
 * spelled. No mode reads as no mode; a night with nobody else in it says nothing about company.
 * Your own character is not listed, the same rule the page's own heading follows.
 */
export function nightLabel(night: PoolNight, party: Party): string {
  const others = night.members.filter((member) => member.characterId !== party.characterId);
  return [
    formatWeekStart(night.weekStart),
    night.difficulty === null ? null : difficultyLabel(night.difficulty),
    others.length === 0 ? null : others.map((member) => member.name).join(", "),
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");
}

/**
 * Whether this night was run at the mode the config carries now.
 *
 * The MODE alone, not the roster. Extreme Kalos and Chaos Kalos are different content that share a
 * row only because a config is one per (character, boss) and a one-off takes over the row its pair
 * already has: a Chaos party cannot have produced an Extreme night's coupons, so showing them
 * together was the page claiming a drop it could not make. A roster that differs is the ordinary
 * case of somebody missing a week, and it is already answered without hiding anything, by heading
 * each night with who ran it and by dividing each drop through ranSeats.
 *
 * A night with NO mode recorded matches. It contradicts nothing, and it is most of the history:
 * every drop logged before V69 carries none, tonight's included where it was logged first. Reading
 * a silence as a mismatch would hide the very night the page is about.
 */
export function ranAtThisMode(night: PoolNight, party: Party): boolean {
  return night.difficulty === null || night.difficulty === party.difficulty;
}
