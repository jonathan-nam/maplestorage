import type { Character } from "@/types/character";

// Characters gathered under the world they play in.
//
// A world is the unit that matters: characters in different worlds cannot boss together or trade,
// and that is true of Scania and Bera as much as of Scania and Kronos. The Characters page is
// already narrowed to one CATEGORY, which is one level too coarse, so this is what makes the real
// division visible while the list still spans several worlds.

export type CharacterGroup = {
  /** The world's display name, or null for characters whose world has not been looked up yet. */
  world: string | null;
  characters: Character[];
};

/**
 * The characters gathered by world, in the order the worlds first appear.
 *
 * First appearance rather than alphabetical, so the groups follow the order you arranged your
 * characters in rather than an order nobody chose. Within a group the given order is kept, which is
 * carousel order.
 *
 * Characters with no world go last whatever order they arrived in. That group is not a world, it is
 * the ones nobody has looked up, and floating it to the top on the accident of who sorts first
 * would push the answered characters below the unanswered ones.
 */
export function groupByWorld(characters: Character[]): CharacterGroup[] {
  const groups: CharacterGroup[] = [];
  const unknown: Character[] = [];

  for (const character of characters) {
    if (character.worldName === null) {
      unknown.push(character);
      continue;
    }
    const existing = groups.find((g) => g.world === character.worldName);
    if (existing) existing.characters.push(character);
    else groups.push({ world: character.worldName, characters: [character] });
  }

  if (unknown.length > 0) groups.push({ world: null, characters: unknown });
  return groups;
}
