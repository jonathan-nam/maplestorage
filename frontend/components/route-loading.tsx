import type { ReactNode } from "react";

/**
 * The class a <main> wears while what it will show has not arrived.
 *
 * One name for one rule, because the router's wait and the page's own fetch look identical on
 * screen and differ only in which component happens to be mounted. What it does is in globals.css
 * under .page-waiting: nothing is drawn for the first 150ms, the same delay the bar keeps.
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
