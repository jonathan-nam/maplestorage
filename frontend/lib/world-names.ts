import type { WorldType } from "@/lib/world";

/**
 * The GMS worlds in each category, in the order GmsWorld.kt declares them.
 *
 * Mirrors backend users/GmsWorld.kt, which is the source of truth: those four rows were each
 * pinned by looking up a character whose world its owner named. world-names.test.ts reads that file
 * and holds this list to it, so a world Nexon adds or merges cannot go stale here silently. That
 * is the same arrangement tab-marks.test.ts has with catalog/build.py's ICON_VERSION.
 *
 * A category is not a world: Bera and Scania cannot party or trade with each other any more than
 * Scania and Kronos can. Naming both is what makes the choice answerable, because a player knows
 * which world they log into and does not necessarily know which category Nexon files it under.
 */
export const WORLDS_IN: Record<WorldType, string[]> = {
  INTERACTIVE: ["Bera", "Scania"],
  HEROIC: ["Kronos", "Hyperion"],
};
