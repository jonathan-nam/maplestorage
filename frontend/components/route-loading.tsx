import type { ReactNode } from "react";

/**
 * The class a <main> wears while what it will show has not arrived.
 *
 * One name for one rule, because the router's wait and the page's own fetch look identical on
 * screen and differ only in which component happens to be mounted. What it does is in globals.css
 * under .page-waiting: nothing is drawn for the first 150ms, the same delay the bar keeps.
 */
export const PAGE_WAITING = "page page-waiting";

/**
 * The class the content that was being waited for wears when it arrives.
 *
 * The pair of PAGE_WAITING, and the same argument: the wait and the arrival are one transition, so
 * both ends of it are named in one place. What it does is in globals.css under .page-ready.
 *
 * It goes on the content, not on the <main>. The title is drawn through the wait as well, so
 * fading the whole page in blinks the one part of it that never went anywhere.
 */
export const PAGE_READY = "page-ready";

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
