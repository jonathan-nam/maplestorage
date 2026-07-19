"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// Account sections live behind a hamburger beside the brand. The menu was built as scaffolding for
// exactly this: a new section is one more entry, not a re-layout.
// /characters redirects to /inventory (see next.config), so old links keep working.
//
// A group is a heading with its own links, NOT a link itself: there is no /bossing page, and a
// heading that navigated nowhere would be the one thing in here that lies about what it does.
const SECTIONS: { group?: string; items: { href: string; label: string }[] }[] = [
  { items: [{ href: "/inventory", label: "Inventory" }] },
  {
    group: "Bossing",
    items: [
      { href: "/bosses", label: "Boss Clears" },
      { href: "/bosses/split", label: "Split Utility" },
    ],
  },
];

const HREFS = SECTIONS.flatMap((s) => s.items.map((i) => i.href));

export function SectionMenu() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Longest matching href wins, so /bosses/split lights up "Split Utility" alone. A plain
  // startsWith would light up "Boss Clears" as well, since one section nests under the other.
  const active = HREFS.filter((href) => pathname === href || pathname.startsWith(`${href}/`)).sort(
    (a, b) => b.length - a.length,
  )[0];
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
          {SECTIONS.map((section) => (
            <div
              key={section.group ?? section.items[0]?.href}
              className={section.group ? "section-menu-group" : undefined}
              role={section.group ? "group" : undefined}
              aria-label={section.group}
            >
              {section.group ? <p className="section-menu-group-label">{section.group}</p> : null}
              {section.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  role="menuitem"
                  className={active === item.href ? "active" : ""}
                  onClick={() => setOpen(false)}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
      ) : null}
    </div>
  );
}
