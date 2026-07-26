// Reading a set of party configs.
//
// A config is one of your characters, on one boss, with the people that character runs it with:
// "mechyfechy runs Kalos with CreedBratton". A boss that character solos has no config, so solo
// runs appear nowhere, which is what makes the list short enough to read.

import type { Boss } from "@/types/boss";
import type { Party } from "@/types/party";

/** Six seats, the game's own party limit. Mirrors MAX_PARTY_SIZE in PartyQueries.kt. */
export const MAX_PARTY = 6;

/** The others: every seat but your own character's, which is the config itself. */
export function otherMembers(party: Party) {
  return party.members.filter((m) => m.characterId !== party.characterId);
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

/** What the party list is narrowed to. "not-cleared" is everything `isCleared` rejects. */
export type ClearFilter = "all" | "not-cleared" | "cleared";

/** The configs a filter admits, in the order they came in. */
export function filterByClear(parties: Party[], filter: ClearFilter): Party[] {
  if (filter === "all") return parties;
  return parties.filter((party) => isCleared(party) === (filter === "cleared"));
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

/** The bosses this character has no config for: what "add a party" can still be added for. */
export function bossesWithoutConfig(parties: Party[], bosses: Boss[], characterId: string): Boss[] {
  const taken = new Set(parties.filter((p) => p.characterId === characterId).map((p) => p.bossKey));
  return bosses.filter((boss) => !taken.has(boss.bossKey));
}
