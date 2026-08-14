import { RouteLoading } from "@/components/route-loading";
import { DropLogSkeleton } from "@/components/drop-log-skeleton";

// See app/inventory/loading.tsx for why these boundaries exist. The same skeleton the page shows for
// its own fetch, so handing over to it is invisible.
export default function Loading() {
  return (
    <RouteLoading shaped>
      <h1 className="page-title">Drop Log</h1>
      <DropLogSkeleton />
    </RouteLoading>
  );
}
