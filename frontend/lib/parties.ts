// Reading a party roster: what to call it, and whose it is.
//
// A party has no owning character column on purpose. It is a set of seats, and a seat may be one
// of your characters, so "which parties is Rune in" is a question about the seats. That also means
// one party can appear under two of your characters when both of them are in it, which is right:
// it IS one party, and hiding it from the second character would be the missing row this repo
// prefers to avoid.

import type { Boss } from "@/types/boss";
import type { Party } from "@/types/party";

/** The game's own party limit. Mirrors MAX_PARTY_SIZE in PartyQueries.kt. */
export const MAX_PARTY = 6;

/** A party's display name: what it was called, or who is in it. */
export function partyLabel(party: Party): string {
  const named = party.name?.trim();
  if (named) return named;
  const roster = party.members.map((m) => m.name.trim()).filter(Boolean);
  return roster.length > 0 ? roster.join(" + ") : "Empty party";
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

export type PartyGroup = {
  // Null for parties with no seat of yours in them: still yours to track, just not a character's.
  characterId: string | null;
  parties: Party[];
};

/**
 * Parties grouped under the character that sits in them, in the caller's character order.
 *
 * Characters with no parties are absent rather than shown empty, and the unseated group goes last
 * because it is the exception. Groups are built from `characterOrder` rather than from whatever
 * ids the parties happen to carry, so the page reads in carousel order.
 */
export function partiesByCharacter(parties: Party[], characterOrder: string[]): PartyGroup[] {
  const groups: PartyGroup[] = [];

  for (const characterId of characterOrder) {
    const mine = parties.filter((p) => p.members.some((m) => m.characterId === characterId));
    if (mine.length > 0) groups.push({ characterId, parties: mine });
  }

  const unseated = parties.filter((p) => p.members.every((m) => m.characterId === null));
  if (unseated.length > 0) groups.push({ characterId: null, parties: unseated });

  return groups;
}

export type PartyBoss = { key: string; name: string; iconUrl: string | null };

export type BossRun = {
  boss: PartyBoss;
  party: Party;
};

/**
 * One entry per (party, boss), in catalog order.
 *
 * A party that runs three bosses is three runs here, because that is how a week is actually
 * planned: you do not sit down to do "the duo", you sit down to do Kalos. Grouped by party the
 * same information reads as one row, which is right for editing and wrong for looking up who you
 * need for tonight's boss.
 *
 * A party with no bosses yet appears in no run. It has nothing to be listed under, and inventing a
 * row for it would put a party under a boss it does not run.
 */
export function runsByBoss(parties: Party[], bosses: Boss[]): BossRun[] {
  const runs: BossRun[] = [];
  // Driven by the catalog rather than by the parties, so the list reads in progression order and
  // two parties on the same boss land next to each other.
  for (const boss of bosses) {
    for (const party of parties) {
      if (party.bossKeys.includes(boss.bossKey)) {
        runs.push({
          boss: { key: boss.bossKey, name: boss.name, iconUrl: boss.iconUrl },
          party,
        });
      }
    }
  }
  return runs;
}

/** Which bosses a party covers, in the catalog's order rather than the party's. */
export function bossesFor(party: Party, bossByKey: Map<string, Boss>): PartyBoss[] {
  // A key the catalog does not have is shown as the raw key, art-less. Ugly and honest; dropping
  // it would quietly shorten the list of bosses this party is for.
  return party.bossKeys.map((key) => {
    const boss = bossByKey.get(key);
    return { key, name: boss?.name ?? key, iconUrl: boss?.iconUrl ?? null };
  });
}
