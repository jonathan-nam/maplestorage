import { RouteLoading } from "@/components/route-loading";
import { BossMatrix } from "@/components/boss-matrix";

// Shown from the instant a nav link is clicked until this route's own JS has mounted. Without a
// loading boundary the router holds the PREVIOUS page on screen for that whole window, so a click
// had no feedback and the new page then arrived in two visible steps (chrome, then data).
//
// The chrome must match the page exactly. It renders the same skeleton the page renders for its own
// fetch, so handing over to the page is invisible. That cuts both ways: these boundaries stood a
// DockSkeleton long after #440 took the dropzone off the pages, so every nav click flashed a
// screenshot dock the page itself never drew.
//
// The empty arrays are deliberate, not a placeholder: BossMatrix substitutes its own
// SKELETON_BOSSES/SKELETON_CHARACTERS when asked to load with nothing to lay out, so this is the
// same shimmer table the page itself shows. Nothing to seed from here, this renders on the server.
export default function Loading() {
  return (
    <RouteLoading shaped>
      <h1 className="page-title">Individual View</h1>
      <BossMatrix loading bosses={[]} characters={[]} clearsByCharacter={{}} />
    </RouteLoading>
  );
}
