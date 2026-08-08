// Reading a set of party configs.
//
// A config is one of your characters, on one boss, with the people that character runs it with:
// "mechyfechy runs Kalos with CreedBratton". A boss that character solos has a config too, holding
// what fell on it, but it is not a party and is not in any list this file reads: /api/parties leaves
// solo configs out unless asked, which is what keeps the list short enough to read.

import { weekEndExclusive } from "@/lib/boss-clears";
import type { Boss } from "@/types/boss";
import type { Party } from "@/types/party";

/** Six seats, the game's own party limit. Mirrors MAX_PARTY_SIZE in PartyQueries.kt. */
export const MAX_PARTY = 6;

/** The others: every seat but your own character's, which is the config itself. */
export function otherMembers(party: Party) {
  return party.members.filter((m) => m.characterId !== party.characterId);
}

/**
 * Every character name the app already knows: your roster, the people list, and whoever is already
 * sitting in a party.
 *
 * Not a nicety. Seats are matched to existing rows by name, so a spelling that misses does not
 * rename a seat, it abandons that one and makes another.
 */
export function knownCharacterNames(
  characters: { name: string }[],
  people: { characters: string[] }[],
  parties: Party[],
): string[] {
  return Array.from(
    new Set([
      ...characters.map((c) => c.name),
      ...people.flatMap((p) => p.characters),
      ...parties.flatMap((p) => p.members.map((m) => m.name)),
    ]),
  ).sort();
}

/**
 * How a party of this size gets said out loud. "Duo" and "trio" are what people call these; four
 * and up have no such word, so they keep the count.
 */
export function partySizeLabel(size: number): string {
  if (size <= 1) return "Solo";
  if (size === 2) return "Duo";
  if (size === 3) return "Trio";
  return `${size}-man`;
}

/**
 * Whether this config is done for the period it is in.
 *
 * Strictly `=== true`. Null is "no capture has said anything about it", which is a row that still
 * needs an answer rather than a finished one, so it counts as outstanding. party-card.tsx draws
 * the same line when it steps a cleared row back.
 */
export function isCleared(party: Party): boolean {
  return party.cleared === true;
}

/**
 * The configs actually being run in the period on screen.
 *
 * A party taken off a period is still a party: the config stands, its pool stands, and it comes
 * back on its own next period. What it is not is work outstanding, so it is out of the list and out
 * of every count beside it. Shared with Run Order so a night cannot be planned around a boss this
 * page has already dropped.
 */
export function runningThisPeriod(parties: Party[]): Party[] {
  return parties.filter((party) => !party.skippedThisPeriod);
}

/** What the party list is narrowed to. "not-cleared" is everything `isCleared` rejects. */
export type ClearFilter = "all" | "not-cleared" | "cleared";

/**
 * The configs a filter admits, in the order they came in.
 *
 * `cleared` is the config's own answer by default. Party View passes its own on a past week, where
 * the clear comes from that week's rows rather than from the config: filtering on party.cleared
 * there would narrow the list by THIS week's state while showing last week's ticks.
 */
export function filterByClear(
  parties: Party[],
  filter: ClearFilter,
  cleared: (party: Party) => boolean = isCleared,
): Party[] {
  if (filter === "all") return parties;
  return parties.filter((party) => cleared(party) === (filter === "cleared"));
}

/**
 * The configs that already existed in the week starting `weekStart`.
 *
 * A config is not history. It says who you run a boss with NOW, so drawing today's list under a past
 * week attributed that week's clears to parties which did not exist then, beside a roster that was
 * not that week's roster. The clear was real, the party around it was imported from this week.
 *
 * Compared as UTC days, not as instants: both sides are already UTC, and comparing the timestamps
 * would turn on how many fractional-second digits Postgres happened to emit.
 */
export function existedInWeek(parties: Party[], weekStart: string): Party[] {
  const end = weekEndExclusive(weekStart);
  return parties.filter((party) => party.createdAt.slice(0, 10) < end);
}

export type PartyGroup<T> = {
  key: T;
  parties: Party[];
};

/**
 * Configs grouped under the character they belong to, in roster order.
 *
 * A character with no configs is absent rather than shown empty: they solo everything, or you have
 * not filled them in, and either way there is nothing to read.
 */
export function byCharacter(parties: Party[], characterOrder: string[]): PartyGroup<string>[] {
  return characterOrder
    .map((characterId) => ({
      key: characterId,
      parties: parties.filter((p) => p.characterId === characterId),
    }))
    .filter((group) => group.parties.length > 0);
}

/**
 * Configs grouped under the boss they are for, in catalog order.
 *
 * The other way to read the same list: "who am I doing Kalos with tonight" rather than "what does
 * this character run".
 */
export function byBoss(parties: Party[], bosses: Boss[]): PartyGroup<Boss>[] {
  return bosses
    .map((boss) => ({ key: boss, parties: parties.filter((p) => p.bossKey === boss.bossKey) }))
    .filter((group) => group.parties.length > 0);
}

export type ConsolidatedParty = {
  key: string;
  characterId: string;
  /** The roster, taken from the first config: they are identical by construction. */
  members: Party["members"];
  /** The configs this arrangement covers, one per boss, in the order they arrived (catalog). */
  parties: Party[];
};

/**
 * Configs with the same roster, merged into one entry per arrangement.
 *
 * A duo with CreedBratton across Kalos, First Adversary and Baldrix is one arrangement and three
 * runs. Per boss is the right shape on the night; per arrangement is the right shape when the
 * question is who you run with rather than what is on tonight.
 *
 * A VIEW, not a merge of the underlying configs. Each boss keeps its own config and its own loot
 * pool, because a drop comes off one boss and a pool that pooled three would be back to the
 * splitting-what-cannot-be-split problem.
 */
export function consolidate(parties: Party[], characterOrder: string[]): ConsolidatedParty[] {
  const groups = new Map<string, ConsolidatedParty>();

  for (const characterId of characterOrder) {
    for (const party of parties.filter((p) => p.characterId === characterId)) {
      // Sorted and lowercased, so the same people in a different order are the same arrangement.
      const roster = otherMembers(party)
        .map((m) => m.name.trim().toLowerCase())
        .sort()
        .join("|");
      const key = `${characterId}::${roster}`;
      const existing = groups.get(key);
      if (existing) {
        existing.parties.push(party);
      } else {
        groups.set(key, { key, characterId, members: party.members, parties: [party] });
      }
    }
  }

  return [...groups.values()];
}

/**
 * The bosses this character can still be given a party for.
 *
 * Everything with no config, plus the one-offs whose period has passed. Those still hold the pair's
 * slot (idx_party_character_boss), and the server takes the config over rather than making a second
 * one, so offering them offers something that works.
 *
 * A STANDING party taken off the period is not here. It has a config, it is on again next period,
 * and adding over it would overwrite the roster and difficulty it already carries. Putting that one
 * back is the edit page's own button.
 */
export function bossesWithoutConfig(parties: Party[], bosses: Boss[], characterId: string): Boss[] {
  const taken = new Set(
    parties
      .filter((p) => p.characterId === characterId && !(p.oneOff && p.skippedThisPeriod))
      .map((p) => p.bossKey),
  );
  return bosses.filter((boss) => !taken.has(boss.bossKey));
}

/**
 * The bosses this character runs alone: everything it has no PARTY for.
 *
 * What the Drop Log offers. Deliberately not bossesWithoutConfig: a boss that already holds a solo
 * pool HAS a config, and narrowing on that would make the second drop on it unloggable.
 *
 * Read against a list that includes solo configs, which only the Drop Log asks for. Given the
 * ordinary list it still answers correctly, since a config that is not there cannot be a party.
 */
export function bossesWithoutParty(parties: Party[], bosses: Boss[], characterId: string): Boss[] {
  const partied = new Set(
    parties.filter((p) => p.characterId === characterId && !p.solo).map((p) => p.bossKey),
  );
  return bosses.filter((boss) => !partied.has(boss.bossKey));
}
