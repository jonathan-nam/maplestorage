import type { ReactNode } from "react";

/**
 * The class a <main> wears while what it will show has not arrived.
 *
 * One name for one rule, because the router's wait and the page's own fetch look identical on
 * screen and differ only in which component happens to be mounted. What it does is in globals.css
 * under .page-waiting: nothing is drawn for the first 400ms, so a page that arrives inside that
 * appears once and whole instead of in stages.
 */
export const PAGE_WAITING = "page page-waiting";

/**
 * The line that says a page is still coming.
 *
 * A component rather than the markup spelled out, for the same reason RouteLoading is one: it is
 * written by copying a neighbour, and the class carrying its delay is silent to forget. Waits
 * longer than the frame around it, because it is the one thing on a waiting page that gets thrown
 * away rather than filled in. See .waiting-note in globals.css.
 */
export function WaitingNote({ children }: { children?: ReactNode }) {
  return <p className="party-hint waiting-note">{children ?? "Loading..."}</p>;
}

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
