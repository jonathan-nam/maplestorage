"use client";

import { useEffect, useRef, useState } from "react";
import { apiAssetUrl } from "@/lib/api";

// The real inventory is 16x8 -- the same lattice the parser locks onto
// (vision/app/cv/grid.py), and the same 128 the client's own "SLOT 112 / 128"
// readout counts against.
const COLS = 16;
const ROWS = 8;
const SLOTS = COLS * ROWS;

// The client's tab row, in its order and with its spelling ("Etc." and "Set-up"
// carry their punctuation in-game). Tokens are consumables, so everything we
// track lives in Use.
const CATEGORIES = ["Equip", "Use", "Etc.", "Set-up", "Cash", "Dec."] as const;
type Category = (typeof CATEGORIES)[number];

export type InventoryItem = {
  id: string;
  name: string;
  iconUrl: string | null;
  quantity: number;
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

  // Tab cycles tabs, as it does in-game. Only while the panel holds focus, so Tab
  // keeps meaning "next element" everywhere else on the page -- and Escape hands
  // focus back, so a keyboard user is never stuck inside the panel.
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
      className={`ms-window${focused ? " focused" : ""}`}
      tabIndex={0}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    >
      <div className="ms-titlebar">
        <span className="ms-title">INVENTORY</span>
        <span className="ms-title-sub">
          {title}
          {subtitle ? ` · ${subtitle}` : ""}
        </span>
        <span className="ms-window-buttons" aria-hidden="true">
          <i>&#8211;</i>
          <i>+</i>
          <i>&#215;</i>
        </span>
      </div>

      <div className="ms-tabs" role="tablist">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            role="tab"
            aria-selected={c === category}
            className={`ms-tab${c === category ? " active" : ""}`}
            onClick={() => setCategory(c)}
          >
            {c}
          </button>
        ))}
      </div>

      <div className="ms-toolbar">
        <span className="ms-btn primary">Sort</span>
        <span className="ms-btn">Lock</span>
        <span className="ms-slot-readout">
          <span className="ms-slot-label">SLOT</span>
          <span className="ms-slot-pill">
            {shown.length} / {SLOTS}
          </span>
        </span>
      </div>

      <div className="ms-grid" style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)` }}>
        {Array.from({ length: SLOTS }, (_, i) => {
          const item = shown[i];
          if (!item) return <div key={i} className="ms-slot" />;
          return (
            <div
              key={i}
              className="ms-slot filled"
              title={`${item.name}\n${item.quantity}${item.note ? `\n${item.note}` : ""}`}
            >
              {item.iconUrl && <img src={apiAssetUrl(item.iconUrl)} alt={item.name} />}
              <span className="ms-qty">{item.quantity}</span>
            </div>
          );
        })}
      </div>

      <div className="ms-footer">
        <span className="ms-footer-note">
          {shown.length === 0 && category === "Use" && (emptyHint ?? "Nothing here yet.")}
          {shown.length === 0 && category !== "Use" && `No ${category} items.`}
        </span>
        <span className="ms-hint">
          {focused ? "Tab to switch · Esc to leave" : "Click to focus"}
        </span>
      </div>
    </div>
  );
}
