"use client";

import { apiAssetUrl } from "@/lib/api";

// The real inventory is 16 wide -- the same lattice the parser locks onto
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
  // How this count differs from what is already stored. Only the preview sets it: it is the
  // whole point of showing a parse before writing it.
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
        const title =
          `${item.name}\n${item.quantity}` +
          (item.delta === null ? "\nnot tracked for this character yet" : "") +
          (typeof item.delta === "number" && item.delta !== 0
            ? `\n${item.delta > 0 ? "up" : "down"} ${Math.abs(item.delta)} since the last screenshot`
            : "") +
          (item.note ? `\n${item.note}` : "");

        return (
          <div key={i} className="ms-slot filled" title={title}>
            {item.iconUrl && <img src={apiAssetUrl(item.iconUrl)} alt={item.name} />}
            <span className="ms-qty">{item.quantity}</span>
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
