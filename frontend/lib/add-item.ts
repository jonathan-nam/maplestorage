// Which items a character could start holding, for the + at the end of the grid.
//
// The grid draws what somebody HOLDS, so an item at zero has no slot to hover and no stepper to
// raise. That is the one case typing has to cover and hovering cannot, and it is the case a
// screenshot used to cover by seeing the item in the window.

import type { TokenCatalogItem } from "@/types/token-catalog";

/** Enough of a held row to know it is held. Mirrors CharacterToken. */
type Held = { tokenCatalogId: string };

/**
 * The catalog minus what this character already holds, in the catalog's own order.
 *
 * Absence IS zero here: the server deletes a row rather than storing a zero (see writeTokenCount),
 * so "not in the held list" and "has none" are the same fact and there is no third state to worry
 * about.
 *
 * Catalog order rather than alphabetical, so the list reads down the same sections the inventory
 * does and an item is where you last saw it.
 */
export function addableItems(catalog: TokenCatalogItem[], held: Held[]): TokenCatalogItem[] {
  const already = new Set(held.map((h) => h.tokenCatalogId));
  return catalog.filter((item) => !already.has(item.tokenCatalogId));
}

/**
 * What a newly added item starts at.
 *
 * One, not zero. Adding something you have none of is not a thing anybody does, and a zero would
 * be deleted by the server the moment it was written, so the slot would appear and vanish. The
 * stepper takes it from there.
 */
export const STARTING_COUNT = 1;
