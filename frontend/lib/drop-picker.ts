// What a drop picker may offer, and what it posts.
//
// Held apart from the component because two screens carry the picker now (the party's loot pool
// and a row on Party View), and the world filter is the one rule here that can produce a wrong
// pool: offering a scroll coupon in a Heroic world is offering to log a drop that cannot happen.

import { dropExistsIn, isPerMember } from "./world";
import type { BossDrop } from "@/types/drop";
import type { AddLootBody } from "@/types/loot";
import type { WorldType } from "./world";

/** "Type it instead". Not a drop key, so nothing in the catalog can collide with it. */
export const OTHER = "__other__";

/** Only what drops where this party plays. See dropExistsIn. */
export function pickableDrops(table: BossDrop[] | undefined, world: WorldType): BossDrop[] {
  return (table ?? []).filter((drop) => dropExistsIn(drop.worlds, world));
}

/** The name, and whether everyone walks away with one. */
export function dropOptionLabel(drop: BossDrop, world: WorldType): string {
  return isPerMember(drop.perMember, world) ? `${drop.name} (one each)` : drop.name;
}

/**
 * What the picker would post, or null while it is not a complete answer.
 *
 * The submit button reads its enabled state off this same function, so the two cannot disagree.
 * They were separate expressions before, which is how a button ends up enabled on a rule the body
 * does not hold to and posts a drop with no name.
 *
 * No boss is not an answer either. It used to be sent as null, from a caller that always had one
 * anyway; the Drop Log asks for the boss, and a drop filed under none is one nothing can find or
 * count. The field stays nullable because the API accepts a drop that names no boss.
 *
 * `droppedOn` is deliberately absent: the server stamps today. A caller that let you add to a week
 * it is not currently in would have to send one, and none may.
 */
export function addDropBody(
  bossKey: string,
  dropKey: string,
  customName: string,
): AddLootBody | null {
  if (bossKey === "") return null;
  if (dropKey === OTHER) {
    const typed = customName.trim();
    return typed === "" ? null : { bossKey, dropKey: null, customName: typed };
  }
  return dropKey === "" ? null : { bossKey, dropKey, customName: null };
}
