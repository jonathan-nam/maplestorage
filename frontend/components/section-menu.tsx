"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { activeHref, MENU_HREFS, sectionsFor } from "@/lib/section-menu";
import { useAccountSettings } from "@/lib/use-account-settings";

// Account sections live behind a hamburger beside the brand. What it lists, and which entry a path
// belongs to, are in lib/section-menu.ts, where they can be tested: the highlight rule fails
// silently, by lighting the wrong word rather than by erroring.

/** Longest a navigation is allowed to hold the page dimmed. See `navigating` below. */
const PENDING_BACKSTOP_MS = 8000;

export function SectionMenu() {
  const [open, setOpen] = useState(false);
  // A click that has not landed yet. It dims the page and runs the bar; see .nav-pending.
  const [navigating, setNavigating] = useState(false);
  const pathname = usePathname();

  const active = activeHref(pathname);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  // Nothing splits in a Heroic world, so the Split Utility is off the list while one is shown. It
  // still routes either way, and prefetching it costs nothing worth branching on.
  const sections = sectionsFor(useAccountSettings()?.trades);

  // The panel below only mounts while the menu is open, and <Link> prefetches on entering the
  // viewport, so the routes got at most the moment between opening the menu and clicking an item.
  // Warm them from the header instead, which is mounted on every page. Doing it by hiding a
  // rendered panel does not work: display:none never intersects so it would not prefetch at all,
  // and an opacity-hidden panel leaves focusable links inside a closed menu.
  //
  // Every section, deduped by the router cache. No effect under `next dev`, which never prefetches.
  useEffect(() => {
    for (const href of MENU_HREFS) router.prefetch(href);
  }, [router]);

  // The route arriving ends the wait. Held here rather than read from useLinkStatus, because that
  // hook only reports from inside a mounted <Link> and the panel closes on the click.
  //
  // Holding the panel open instead was tried and reverted: it put the only feedback on the control
  // rather than on the page, and a menu that does not close is read as a click that did not
  // register. Closing is what says the click landed; the page says what is coming.
  //
  // During render, not in an effect: an effect clears it a paint later, and the linter refuses it.
  // Not `openedAtPath === pathname` either, which reopens the menu on a Back to the page it was
  // opened from.
  const [pathShown, setPathShown] = useState(pathname);
  if (pathShown !== pathname) {
    setPathShown(pathname);
    setOpen(false);
    setNavigating(false);
  }

  // A navigation that never lands must not leave the page dimmed for good. Same backstop the world
  // veil keeps, and for the same reason: the failure mode of a cover is that it never lifts.
  useEffect(() => {
    if (!navigating) return;
    const timer = setTimeout(() => setNavigating(false), PENDING_BACKSTOP_MS);
    return () => clearTimeout(timer);
  }, [navigating]);

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
      {/* The page is going. Rendered from here because the menu outlives the navigation it starts,
          while the page under it does not. CSS does the waiting and the dimming: see .nav-pending. */}
      {navigating ? <span className="nav-pending" role="status" aria-label="Loading" /> : null}

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
          {sections.map((section) => (
            <div
              key={section.group ?? section.items[0]?.href}
              className={section.group ? "section-menu-group" : undefined}
              role={section.group ? "group" : undefined}
              aria-label={section.group}
            >
              {section.group ? <p className="section-menu-group-label">{section.group}</p> : null}
              {section.items
                .filter((item) => !item.hidden)
                .map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    role="menuitem"
                    className={active === item.href ? "active" : ""}
                    onClick={() => {
                      setOpen(false);
                      // Not for the page you are already on: nothing navigates, so nothing would
                      // ever clear it.
                      setNavigating(pathname !== item.href);
                    }}
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
