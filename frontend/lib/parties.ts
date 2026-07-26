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

/** One line of the parties list: a party, and whichever axes it has been split by. */
export type PartyRow = {
  party: Party;
  /** Set when split by boss: which of the party's bosses this row is for. */
  boss: PartyBoss | null;
  /** Set when split by character: which of YOUR characters in the party this row is for. */
  characterId: string | null;
};

export type Expansion = {
  byBoss: boolean;
  byCharacter: boolean;
};

/**
 * The parties, split along whichever axes are switched on.
 *
 * Neither: one row per party, which is how it is edited. By boss: a party that runs three bosses
 * is three rows, because on the night it is three things to do and the question is "who am I doing
 * Kalos with". By character: one row per character of yours in it. Both: one row per
 * character-boss pair, which is that character's night.
 *
 * Nothing is ever dropped by a split. A party with no bosses still appears when splitting by boss,
 * and one with none of your characters still appears when splitting by character; they just have
 * nothing in that column. A row that vanished because it had no value on an axis would be a party
 * you own and cannot see.
 */
export function expandParties(
  parties: Party[],
  bosses: Boss[],
  characterOrder: string[],
  { byBoss, byCharacter }: Expansion,
): PartyRow[] {
  const rows: PartyRow[] = [];

  for (const party of parties) {
    // Catalog order, not the party's, so two parties on the same boss sort together.
    const bossesHere = byBoss ? bosses.filter((b) => party.bossKeys.includes(b.bossKey)) : [];
    const mine = byCharacter
      ? characterOrder.filter((id) => party.members.some((m) => m.characterId === id))
      : [];

    const bossSlots: (PartyBoss | null)[] = bossesHere.length
      ? bossesHere.map((b) => ({ key: b.bossKey, name: b.name, iconUrl: b.iconUrl }))
      : [null];
    const characterSlots: (string | null)[] = mine.length ? mine : [null];

    for (const characterId of characterSlots) {
      for (const boss of bossSlots) {
        rows.push({ party, boss, characterId });
      }
    }
  }

  // Character first, then boss: with both axes on, the list reads as one character's night rather
  // than as a boss with several people's characters interleaved under it.
  const characterRank = (id: string | null) =>
    id === null ? characterOrder.length : characterOrder.indexOf(id);
  const bossRank = (key: string | null) =>
    key === null ? bosses.length : bosses.findIndex((b) => b.bossKey === key);
  return rows.sort(
    (a, b) =>
      characterRank(a.characterId) - characterRank(b.characterId) ||
      bossRank(a.boss?.key ?? null) - bossRank(b.boss?.key ?? null),
  );
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
