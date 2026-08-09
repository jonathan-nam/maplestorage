"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { activeHref, MENU_HREFS, sectionsFor } from "@/lib/section-menu";
import { useAccountSettings } from "@/lib/use-account-settings";

// Account sections live behind a hamburger beside the brand. What it lists, and which entry a path
// belongs to, are in lib/section-menu.ts, where they can be tested: the highlight rule fails
// silently, by lighting the wrong word rather than by erroring.

/**
 * Reports whether the <Link> above it is mid-navigation.
 *
 * useLinkStatus only reads the link it is rendered inside, so this exists to be that child. It
 * draws nothing: the mark goes on the link, through the class the menu puts there.
 */
function LinkPending({
  href,
  onPending,
}: {
  href: string;
  onPending: (href: string | null) => void;
}) {
  const { pending } = useLinkStatus();
  useEffect(() => {
    if (!pending) return;
    onPending(href);
    return () => onPending(null);
  }, [pending, href, onPending]);
  return null;
}

export function SectionMenu() {
  const [open, setOpen] = useState(false);
  // The entry that has been clicked and not yet arrived. Only one can be in flight: the panel is
  // held open until the route commits, but a second click replaces the first navigation anyway.
  const [pending, setPending] = useState<string | null>(null);
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

  // Closed by the route arriving, not by the click. Closing on the click dismissed the panel into
  // a page that then sat unchanged (measured: 711ms on a cold route), so the only feedback a click
  // had was that something had gone away. Held open, the clicked entry can say it is coming.
  //
  // It has to stay mounted for that: an unmounted <Link> has no pending state for useLinkStatus to
  // read. `pending` needs no reset here, because unmounting the panel runs LinkPending's cleanup.
  //
  // During render, not in an effect: an effect closes it a paint later, and the linter refuses it.
  // Not `open && openedAtPath === pathname` either, which reopens the menu on a Back to the page
  // it was opened from.
  const [pathShown, setPathShown] = useState(pathname);
  if (pathShown !== pathname) {
    setPathShown(pathname);
    setOpen(false);
  }

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
                    className={[
                      active === item.href ? "active" : "",
                      pending === item.href ? "is-pending" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    // The page you are already on. The pathname never changes, so the reset above
                    // never runs and nothing else would close the panel.
                    onClick={() => pathname === item.href && setOpen(false)}
                  >
                    {item.label}
                    <LinkPending href={item.href} onPending={setPending} />
                  </Link>
                ))}
            </div>
          ))}
        </nav>
      ) : null}
    </div>
  );
}
