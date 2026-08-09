"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { startsNavigation } from "@/lib/nav-pending";

/** Longest a navigation may hold the page dimmed. */
const BACKSTOP_MS = 8000;

/**
 * What is on screen between asking for a page and getting it.
 *
 * A bar across the top and the outgoing content dimmed, both delayed so a fast route shows
 * nothing. The look is in globals.css under .nav-pending; this decides only when it is up.
 *
 * One delegated listener rather than a prop on each link. Every route in this app is reached by a
 * <Link>, and the ones that had no feedback were the ones nobody thought to wire: Party View's
 * Wallet, Drop Log and Edit parties all sat silent while the hamburger had a bar. A rule that
 * covers every anchor cannot be forgotten by the next link somebody adds.
 *
 * Deliberately NOT skipping on e.defaultPrevented: <Link> calls preventDefault itself to take the
 * navigation off the browser, so that flag marks the clicks this exists for, not the cancelled
 * ones.
 */
export function NavPending() {
  const [pending, setPending] = useState(false);
  const pathname = usePathname();

  // Arriving ends the wait. During render, not in an effect, so the bar is gone in the same paint
  // the new page appears in. See SectionMenu for the same pattern and why not an effect.
  const [pathShown, setPathShown] = useState(pathname);
  if (pathShown !== pathname) {
    setPathShown(pathname);
    setPending(false);
  }

  useEffect(() => {
    function onClick(event: MouseEvent) {
      const anchor = (event.target as Element | null)?.closest?.("a");
      if (
        !startsNavigation({
          button: event.button,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          shiftKey: event.shiftKey,
          altKey: event.altKey,
          href: anchor?.getAttribute("href") === null ? null : (anchor?.href ?? null),
          target: anchor?.getAttribute("target") ?? null,
          download: anchor?.hasAttribute("download") ?? false,
          origin: window.location.origin,
          pathname: window.location.pathname,
        })
      ) {
        return;
      }
      setPending(true);
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  // A navigation that never lands must not leave the page dimmed for good. Same backstop the world
  // veil keeps, and for the same reason: the failure mode of a cover is that it never lifts.
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => setPending(false), BACKSTOP_MS);
    return () => clearTimeout(timer);
  }, [pending]);

  return pending ? <span className="nav-pending" role="status" aria-label="Loading" /> : null;
}
