"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// Account sections live behind a hamburger in the top-left. Only the inventory view exists today;
// the point of the menu is that the next section (boss clears, and so on) is one more entry here,
// not a re-layout. A single-item menu is deliberate scaffolding, not over-engineering.
// Route stays /characters so existing links keep working; only the label reads "Inventory".
const SECTIONS = [{ href: "/characters", label: "Inventory" }];

export function SectionMenu() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const ref = useRef<HTMLDivElement>(null);

  // Close on an outside click or Escape, the two ways a menu should always be dismissable.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="section-menu" ref={ref}>
      <button
        type="button"
        className="section-menu-btn"
        aria-label="Sections"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="section-menu-icon" aria-hidden="true" />
      </button>

      {open ? (
        <nav className="section-menu-panel" role="menu">
          {SECTIONS.map((s) => (
            <Link
              key={s.href}
              href={s.href}
              role="menuitem"
              className={pathname.startsWith(s.href) ? "active" : ""}
              onClick={() => setOpen(false)}
            >
              {s.label}
            </Link>
          ))}
        </nav>
      ) : null}
    </div>
  );
}
