import type { ReactNode } from "react";

/**
 * The class a loading.tsx's <main> wears, where the whole <main> IS the placeholder.
 *
 * Nothing is drawn for the first 150ms, the same delay the bar keeps. See globals.css.
 *
 * A PAGE must not wear this. Its <main> carries the title, which is known immediately and is not a
 * placeholder for anything, and the router unmounts the outgoing page as soon as the route commits:
 * hiding the incoming <main> for 150ms is 150ms of blank screen, not 150ms of the page you came
 * from. A page hands its placeholder to PageSwap, which wears the class instead.
 */
export const PAGE_WAITING = "page page-waiting";

/**
 * The same, where the placeholder is the page's own shape rather than a line of text.
 *
 * Which is to say: no wait treatment at all. It is drawn at once, at full strength, exactly as the
 * loaded page will be. Two measurements killed the alternatives. Held hidden for the delay, the
 * outgoing page went at 9ms and the skeleton did not land until 208ms, so 180ms of the title on an
 * empty screen. Faded up from zero instead, a menu click swapped 747px of page for a near-empty
 * screen that then rose over 200ms, which is the flicker a refresh never shows because a refresh
 * has no outgoing page to compare against.
 *
 * The same string as an ordinary page's <main>, on purpose: the page's own placeholder is bare too,
 * so handing over from this boundary to the page changes nothing on screen.
 */
export const PAGE_WAITING_SHAPED = "page";

// The other end of the wait is components/page-swap.tsx, not a class a page spells out. Fading the
// arriving content in on its own left a blank beat, because the placeholder was already gone, so
// the two have to be held together by something that outlives the handover.

/**
 * The <main> every route's loading.tsx renders.
 *
 * A component rather than a class each boundary spells out: twelve of these exist across four
 * directory levels, the next is written by copying a neighbour, and forgetting the class is
 * silent. The page still works, it just flashes.
 *
 * This boundary is the rarer of the two waits. A route whose payload was already prefetched
 * commits without it ever rendering, which is why the page's own loading state carries the same
 * class.
 */
export function RouteLoading({
  children,
  shaped = false,
}: {
  children: ReactNode;
  /** The placeholder is the page's own shape, so draw it at once. See PAGE_WAITING_SHAPED. */
  shaped?: boolean;
}) {
  return <main className={shaped ? PAGE_WAITING_SHAPED : PAGE_WAITING}>{children}</main>;
}
