// What the drop dropdown offers, where its panel goes, and where an arrow key moves.
//
// A native <select> cannot draw an image in an option, and the item's art is what people recognise
// a coupon by, so the control is a listbox. That buys the icons and costs the browser's own popup:
// the three things below are what the popup did for free, held here where they can be tested.

import { OTHER, dropOptionLabel } from "./drop-picker";
import type { BossDrop } from "@/types/drop";
import type { WorldType } from "./world";

/** One row of the list. `value` is what the picker's state holds: a drop key, OTHER, or "". */
export type DropOption = { value: string; label: string; iconUrl: string | null };

/** The empty row, kept because the <select> it replaces could be put back to nothing. */
export const NOTHING_LABEL = "pick a drop";

/**
 * The rows, in the order a select showed them: nothing, this boss's drops, then "type it instead".
 *
 * Takes the drops already narrowed to the party's world (pickableDrops), not the whole table. The
 * world filter is the one rule here that can produce a wrong pool, so it stays in one place.
 *
 * Typed as non-empty, which is what lets the trigger draw a row without a fallback for the case of
 * no rows at all: a boss with no table still has these two.
 */
export function dropOptions(drops: BossDrop[], world: WorldType): [DropOption, ...DropOption[]] {
  return [
    { value: "", label: NOTHING_LABEL, iconUrl: null },
    ...drops.map((drop) => ({
      value: drop.dropKey,
      label: dropOptionLabel(drop, world),
      iconUrl: drop.iconUrl,
    })),
    { value: OTHER, label: "something else...", iconUrl: null },
  ];
}

/** Where an arrow key moves the highlight. Wraps, and every position is a real row. */
export function nextOption(current: number, count: number, delta: number): number {
  if (count === 0) return 0;
  return (current + delta + count) % count;
}

/** Fixed-position coordinates for the panel, in CSS pixels. */
export type Placement = { left: number; width: number; maxHeight: number } & (
  { top: number } | { bottom: number }
);

/** Room the panel will not open into, so a list flush against the edge is not what you get. */
const MARGIN = 8;

/** Below the trigger unless there is more room above it. Under this the panel scrolls. */
const MIN_HEIGHT = 120;

/**
 * Where to draw the panel, given the trigger's own rect and the viewport.
 *
 * Fixed to the viewport and portalled out of the form, because two of the four screens that carry
 * this picker put it inside something that clips: Run Order's panel row sits in `.run-grid`, which
 * is an `overflow-x: auto` scroll container, so an absolutely positioned list opened on the last
 * row would be cut off at the table's bottom edge rather than drawn over the page.
 *
 * `bottom` rather than a negative `top` when it opens upward: measuring the panel's own height
 * would need it on screen first, and anchoring the bottom edge lets the browser do that sum.
 */
export function panelPlacement(
  trigger: { top: number; bottom: number; left: number; width: number },
  viewport: { width: number; height: number },
): Placement {
  const below = viewport.height - trigger.bottom - MARGIN;
  const above = trigger.top - MARGIN;
  const left = Math.max(MARGIN, Math.min(trigger.left, viewport.width - trigger.width - MARGIN));
  const base = { left, width: trigger.width };

  if (below >= MIN_HEIGHT || below >= above) {
    return { ...base, top: trigger.bottom, maxHeight: Math.max(below, 0) };
  }
  return { ...base, bottom: viewport.height - trigger.top, maxHeight: Math.max(above, 0) };
}
