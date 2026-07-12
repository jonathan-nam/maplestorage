"use client";

import { useEffect, useRef, useState } from "react";
import { apiAssetUrl } from "@/lib/api";

// The real inventory is 16x8 (vision/app/cv/grid.py's COLS, ROWS -- the same
// lattice the parser locks onto). Matching it means a panel here holds exactly
// what a panel in-game holds.
const COLS = 16;
const ROWS = 8;
const SLOTS = COLS * ROWS;

// The game's tab order. Tokens are consumables, so everything we track lives in
// Use; the other four are here because an inventory with one tab isn't an
// inventory, and because the moment we catalog anything else it lands in one.
const CATEGORIES = ["Equip", "Use", "Etc", "Setup", "Cash"] as const;
type Category = (typeof CATEGORIES)[number];

export type InventoryItem = {
  id: string;
  name: string;
  iconUrl: string | null;
  quantity: number;
  // Shown under the name in the tooltip, e.g. progress toward a set.
  note?: string;
};

export function InventoryPanel({
  title,
  subtitle,
  items,
  emptyHint,
}: {
  title: string;
  subtitle?: string;
  items: InventoryItem[];
  emptyHint?: string;
}) {
  const [category, setCategory] = useState<Category>("Use");
  const [focused, setFocused] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Tab cycles tabs, as it does in-game. Only while the panel itself holds focus,
  // so Tab keeps meaning "next element" everywhere else on the page -- and Escape
  // hands focus back, so a keyboard user is never stuck inside the panel.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        panelRef.current?.blur();
        return;
      }
      if (e.key !== "Tab") return;
      e.preventDefault();
      setCategory((current) => {
        const i = CATEGORIES.indexOf(current);
        const step = e.shiftKey ? -1 : 1;
        const next = (i + step + CATEGORIES.length) % CATEGORIES.length;
        return CATEGORIES[next] ?? current;
      });
    }

    panel.addEventListener("keydown", onKeyDown);
    return () => panel.removeEventListener("keydown", onKeyDown);
  }, []);

  const shown = category === "Use" ? items : [];

  return (
    <div
      ref={panelRef}
      className={`inv-panel${focused ? " focused" : ""}`}
      tabIndex={0}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    >
      <div className="inv-titlebar">
        <span className="inv-title">{title}</span>
        {subtitle && <span className="inv-subtitle">{subtitle}</span>}
      </div>

      <div className="inv-tabs" role="tablist">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            role="tab"
            aria-selected={c === category}
            className={`inv-tab${c === category ? " active" : ""}`}
            onClick={() => setCategory(c)}
          >
            {c}
          </button>
        ))}
      </div>

      <div className="inv-grid" style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)` }}>
        {Array.from({ length: SLOTS }, (_, i) => {
          const item = shown[i];
          if (!item) return <div key={i} className="inv-slot" />;
          return (
            <div
              key={i}
              className="inv-slot filled"
              title={`${item.name}\n${item.quantity}${item.note ? `\n${item.note}` : ""}`}
            >
              {item.iconUrl && <img src={apiAssetUrl(item.iconUrl)} alt={item.name} />}
              <span className="inv-qty">{item.quantity}</span>
            </div>
          );
        })}
      </div>

      <div className="inv-footer">
        {shown.length === 0 ? (
          <span className="inv-empty">
            {category === "Use" ? (emptyHint ?? "Nothing here yet.") : `No ${category} items.`}
          </span>
        ) : (
          <span className="inv-count">
            {shown.length} / {SLOTS} slots
          </span>
        )}
        <span className="inv-hint">
          {focused ? "Tab to switch, Esc to leave" : "Click to focus"}
        </span>
      </div>
    </div>
  );
}
