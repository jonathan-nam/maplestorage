"use client";

import { useEffect, useState } from "react";
import { apiAssetUrl } from "@/lib/api";

const TICK_MS = 400;

// Walk the count from what it was to what it is, rather than swapping the number.
//
// The point is not decoration. A screenshot that takes a stack from 286 to 340 is the only reason
// anyone uploads one, and swapping the digits states the result while hiding the event. Watching
// it move says "this went up, by this much" without a caption.
//
// Returns `to` immediately when there is nothing to animate, and when the reader has asked for
// reduced motion, so the number is always correct even when nothing moves. Never interpolate
// toward a value you have not been given: a half-animated count is a wrong number on screen, and
// this app exists to not do that, so the tween always ENDS on `to` exactly.
function useCountUp(to: number, from: number | undefined): number {
  // The frame carries the target it belongs to, so a frame left over from a previous animation can
  // never be painted against a newer count. Without that, a second upload landing mid-tween shows
  // the old stack's number under the new stack's icon, which is precisely the confident wrong
  // number this app exists to avoid. It also lets the hook hold NO state in the common case, so
  // there is nothing to reset and nothing to set synchronously in an effect.
  const [frame, setFrame] = useState<{ to: number; value: number } | null>(null);

  useEffect(() => {
    if (from === undefined || from === to) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let raf = 0;
    const start = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / TICK_MS);
      const eased = 1 - Math.pow(1 - p, 3);
      setFrame({ to, value: p < 1 ? Math.round(from + (to - from) * eased) : to });
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [from, to]);

  return frame?.to === to ? frame.value : to;
}

// The count, drawn from the client's own digit sprites rather than set in a web font.
//
// The in-game count is an 11px bitmap face with a hard black outline, and no web font is that
// font, every approximation of it sits directly beneath a pixel-exact icon and gives itself
// away. We already own the real glyphs: they are the templates the parser reads counts WITH
// (vision/app/cv/templates/digit_*.png), cut from the client, and the backend now serves them.
// So the number below each icon is the same picture the game would draw. `1` is 5px wide and the
// rest are 8px, which is the font's own proportional spacing. Laying them out in a row
// reproduces it for free.
function Count({ value }: { value: number }) {
  return (
    <span className="ms-qty" aria-label={String(value)}>
      {String(value)
        .split("")
        .map((d, i) => (
          <img key={i} src={apiAssetUrl(`/digit-icons/${d}.png`)} alt="" aria-hidden="true" />
        ))}
    </span>
  );
}

// The real inventory is 16 wide, the same lattice the parser locks onto
// (vision/app/cv/grid.py), and the same 128 the client's own "SLOT 112 / 128" readout counts
// against. The preview shows the same 16 columns over fewer rows, so a screenshot's items land
// in the same shape they will occupy once they are saved.
export const COLS = 16;

export type SlotItem = {
  id: string;
  name: string;
  iconUrl: string | null;
  quantity: number;
  note?: string;
  itemGroup?: string | null;
  // What this character held BEFORE the screenshot that just landed. Set only by the inventory,
  // and only for the character the screenshot was written to.
  //
  //   number    = the old count. The slot ticks from it and flashes.
  //   null      = we held none of this: a first sighting, which is a different event from a gain.
  //   undefined = nothing happened, or nothing we can speak to. The slot renders flat.
  //
  // The capture preview deliberately leaves this undefined. It shows what the SCREENSHOT says,
  // faithfully, and the change is the inventory's story to tell.
  previous?: number | null;
};

function Slot({ item }: { item: SlotItem }) {
  const changed = item.previous !== undefined && item.previous !== item.quantity;
  const isNew = item.previous === null;
  const delta = typeof item.previous === "number" ? item.quantity - item.previous : null;

  const shown = useCountUp(
    item.quantity,
    typeof item.previous === "number" ? item.previous : undefined,
  );

  const badge = isNew
    ? "new"
    : delta !== null && delta !== 0
      ? delta > 0
        ? `+${delta}`
        : `${delta}`
      : null;
  const tone = isNew ? "new" : delta !== null && delta > 0 ? "up" : "down";

  const title =
    `${item.name}\n${item.quantity}` +
    (isNew ? "\nnot tracked for this character before" : "") +
    (delta !== null && delta !== 0
      ? `\n${delta > 0 ? "up" : "down"} ${Math.abs(delta)} since the last screenshot`
      : "") +
    (item.note ? `\n${item.note}` : "");

  return (
    <div className={`ms-slot filled${changed ? ` changed ${tone}` : ""}`} title={title}>
      {item.iconUrl && <img src={apiAssetUrl(item.iconUrl)} alt={item.name} />}
      {/* The COUNT is the animated thing, never the icon. `shown` always lands on item.quantity. */}
      <Count value={shown} />
      {changed && badge && <span className={`ms-delta ${tone}`}>{badge}</span>}
    </div>
  );
}

export function SlotGrid({ items, rows }: { items: SlotItem[]; rows: number }) {
  const slots = COLS * rows;
  return (
    <div className="ms-grid" style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)` }}>
      {Array.from({ length: slots }, (_, i) => {
        const item = items[i];
        // Keyed by item id, not by index: a keyed-by-index slot reuses the DOM node when the
        // section reflows, so the tick animation would restart on an item that did not change.
        return item ? (
          <Slot key={item.id} item={item} />
        ) : (
          <div key={`empty-${i}`} className="ms-slot" />
        );
      })}
    </div>
  );
}
