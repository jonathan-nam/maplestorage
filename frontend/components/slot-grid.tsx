"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { CountStepper } from "@/components/count-stepper";
import { apiAssetUrl } from "@/lib/api";

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
  // How this count differs from what is already stored. Only the preview sets it: it is the
  // whole point of showing a parse before writing it. `null` = we hold none of this yet ("new");
  // `undefined` = we cannot say, so say nothing.
  delta?: number | null;
};

function deltaLabel(delta: number | null | undefined): string | null {
  if (delta === null) return "new";
  if (delta === undefined || delta === 0) return null;
  return delta > 0 ? `+${delta}` : `${delta}`;
}

export function SlotGrid({
  items,
  rows,
  onSelectItem,
  onAdjust,
  onCommit,
}: {
  items: SlotItem[];
  rows: number;
  // When set, each filled slot is a button that hands its item name back, so the page can
  // search every character for it. Left unset by the capture preview, whose slots are a parse
  // to look at, not holdings to search.
  onSelectItem?: (name: string) => void;
  // When set, hovering a filled slot raises a stepper ABOVE it. Above rather than on it because
  // the slot is already the search button: two targets in one 42px square would mean a click a few
  // pixels off changed a count when you meant to look the item up.
  onAdjust?: (id: string, next: number) => void;
  // The total to keep once the pressing stops. Separate from onAdjust, which fires on every step
  // and writes nothing.
  onCommit?: (id: string, final: number) => void;
}) {
  const slots = COLS * rows;
  // One stepper at a time, with the slot it belongs to in viewport coordinates: the popover is
  // fixed, so it needs an anchor rather than a positioned parent. See CountStepper.
  const [stepping, setStepping] = useState<{ id: string; anchor: DOMRect } | null>(null);
  // Closing is DELAYED, because the popover sits a few pixels clear of its slot and crossing that
  // gap leaves both. Without the grace period the stepper vanished as you reached for it.
  const closing = useRef<ReturnType<typeof setTimeout> | null>(null);

  function hold(id: string, anchor: DOMRect) {
    if (closing.current) clearTimeout(closing.current);
    setStepping({ id, anchor });
  }

  function release() {
    if (closing.current) clearTimeout(closing.current);
    closing.current = setTimeout(() => setStepping(null), 140);
  }

  // A fixed popover is anchored to where the slot WAS. Scrolling moves the slot and not the
  // popover, so it is dismissed rather than left pointing at the wrong item.
  useEffect(() => {
    if (!stepping) return;
    const drop = () => setStepping(null);
    window.addEventListener("scroll", drop, true);
    return () => window.removeEventListener("scroll", drop, true);
  }, [stepping]);

  useEffect(() => () => (closing.current ? clearTimeout(closing.current) : undefined), []);
  return (
    <div className="ms-grid" style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)` }}>
      {Array.from({ length: slots }, (_, i) => {
        const item = items[i];
        if (!item) return <div key={i} className="ms-slot" />;

        const badge = deltaLabel(item.delta);
        // The tooltip is the item name and nothing else. The count is drawn under the icon
        // already, and the delta/redemption detail lives in the search view a click away.
        const contents = (
          <>
            {item.iconUrl && <img src={apiAssetUrl(item.iconUrl)} alt={item.name} />}
            <Count value={item.quantity} />
            {badge && (
              <span
                className={`ms-delta${item.delta === null ? " new" : item.delta! > 0 ? " up" : " down"}`}
              >
                {badge}
              </span>
            )}
          </>
        );

        const steppable = Boolean(onAdjust && onCommit);
        const slot = onSelectItem ? (
          <button
            type="button"
            className="ms-slot filled clickable"
            title={item.name}
            onClick={() => onSelectItem(item.name)}
          >
            {contents}
          </button>
        ) : (
          <div className="ms-slot filled" title={item.name}>
            {contents}
          </div>
        );

        if (!steppable) return <Fragment key={i}>{slot}</Fragment>;

        return (
          <div
            key={i}
            className="ms-slot-hold"
            onPointerEnter={(e) => hold(item.id, e.currentTarget.getBoundingClientRect())}
            onPointerLeave={release}
          >
            {slot}
            {stepping?.id === item.id && (
              <CountStepper
                value={item.quantity}
                anchor={stepping.anchor}
                label={item.name}
                onChange={(next) => onAdjust!(item.id, next)}
                onCommit={(final) => onCommit!(item.id, final)}
                onPointerEnter={() => hold(item.id, stepping.anchor)}
                onPointerLeave={release}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
