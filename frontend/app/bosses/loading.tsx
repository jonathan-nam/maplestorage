import { RouteLoading } from "@/components/route-loading";
import { BossMatrix } from "@/components/boss-matrix";
import { DockSkeleton } from "@/components/dock-shell";

// See app/inventory/loading.tsx for why these boundaries exist.
//
// The empty arrays are deliberate, not a placeholder: BossMatrix substitutes its own
// SKELETON_BOSSES/SKELETON_CHARACTERS when asked to load with nothing to lay out, so this is the
// same shimmer table the page itself shows. Nothing to seed from here, this renders on the server.
export default function Loading() {
  return (
    <RouteLoading>
      <h1 className="page-title">Individual View</h1>
      <DockSkeleton name="planner" picker />
      <BossMatrix loading bosses={[]} characters={[]} clearsByCharacter={{}} />
    </RouteLoading>
  );
}
