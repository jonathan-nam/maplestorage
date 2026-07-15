"use client";

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

export function SlotGrid({ items, rows }: { items: SlotItem[]; rows: number }) {
  const slots = COLS * rows;
  return (
    <div className="ms-grid" style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)` }}>
      {Array.from({ length: slots }, (_, i) => {
        const item = items[i];
        if (!item) return <div key={i} className="ms-slot" />;

        const badge = deltaLabel(item.delta);
        // The count is already on the tile (the digit sprites), so the tooltip repeats it only
        // where it anchors context: the delta and the "new" line read as information, not an echo.
        const title =
          item.name +
          (item.delta === null
            ? `\n${item.quantity}, not tracked for this character yet`
            : typeof item.delta === "number" && item.delta !== 0
              ? `\n${item.quantity}, ${item.delta > 0 ? "up" : "down"} ${Math.abs(item.delta)} since the last screenshot`
              : "") +
          (item.note ? `\n${item.note}` : "");

        return (
          <div key={i} className="ms-slot filled" title={title}>
            {item.iconUrl && <img src={apiAssetUrl(item.iconUrl)} alt={item.name} />}
            <Count value={item.quantity} />
            {badge && (
              <span
                className={`ms-delta${item.delta === null ? " new" : item.delta! > 0 ? " up" : " down"}`}
              >
                {badge}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
