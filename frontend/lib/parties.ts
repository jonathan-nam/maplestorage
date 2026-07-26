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
 * What to call a config: the label it was given, or who is in it.
 *
 * Falls back to the roster rather than to the boss, because the boss is already the heading
 * everywhere a config is drawn, and "Kalos (Kalos)" says nothing twice.
 */
export function partyLabel(party: Party): string {
  const named = party.name?.trim();
  if (named) return named;
  const roster = otherMembers(party)
    .map((m) => m.name.trim())
    .filter(Boolean);
  return roster.length > 0 ? roster.join(" + ") : "Solo";
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

/** The bosses this character has no config for: what "add a party" can still be added for. */
export function bossesWithoutConfig(parties: Party[], bosses: Boss[], characterId: string): Boss[] {
  const taken = new Set(parties.filter((p) => p.characterId === characterId).map((p) => p.bossKey));
  return bosses.filter((boss) => !taken.has(boss.bossKey));
}
