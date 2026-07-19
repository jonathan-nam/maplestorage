import { CharactersSkeleton } from "@/components/loading-skeleton";

// Shown from the instant a nav link is clicked until this route's own JS has mounted. Without a
// loading boundary the router holds the PREVIOUS page on screen for that whole window, so a click
// had no feedback and the new page then arrived in two visible steps (chrome, then data).
//
// The chrome must match app/inventory/page.tsx exactly. It renders the same skeleton the page
// renders for its own fetch, so handing over to the page is invisible.
export default function Loading() {
  return (
    <main className="page">
      <h1 className="page-title">Inventory</h1>
      <CharactersSkeleton />
    </main>
  );
}
