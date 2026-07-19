"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// Account sections live behind a hamburger in the top-left. The menu was built as scaffolding for
// exactly this: a new section is one more entry, not a re-layout.
// /characters redirects to /inventory (see next.config), so old links keep working.
const SECTIONS = [
  { href: "/inventory", label: "Inventory" },
  { href: "/bosses", label: "Boss clears" },
  { href: "/bosses/split", label: "Drop split" },
];

export function SectionMenu() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Longest matching href wins, so /bosses/split lights up "Drop split" alone. A plain
  // startsWith would light up "Boss clears" as well, since one section nests under the other.
  const active = SECTIONS.map((s) => s.href)
    .filter((href) => pathname === href || pathname.startsWith(`${href}/`))
    .sort((a, b) => b.length - a.length)[0];
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
              className={active === s.href ? "active" : ""}
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
