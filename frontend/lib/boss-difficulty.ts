// How a party says which mode it runs: "Chaos Kalos", "Hard Baldrix", "Extreme Black Mage".
//
// Which modes a boss has is catalog data (catalog/bosses.yaml, served on /api/bosses), so nothing
// here decides it. This is only how one gets written down.

/** Title case, as the game writes it. Stored uppercase, the way `reset` is. */
export function difficultyLabel(difficulty: string): string {
  return difficulty.charAt(0) + difficulty.slice(1).toLowerCase();
}

/** The boss as it gets said out loud. Just the name when no mode has been picked. */
export function bossLabel(name: string, difficulty?: string | null): string {
  return difficulty ? `${difficultyLabel(difficulty)} ${name}` : name;
}
