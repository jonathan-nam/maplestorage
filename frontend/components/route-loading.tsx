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
export function RouteLoading({ children }: { children: ReactNode }) {
  return <main className={PAGE_WAITING}>{children}</main>;
}
