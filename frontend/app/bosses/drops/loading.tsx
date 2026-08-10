import { RouteLoading } from "@/components/route-loading";

// See app/inventory/loading.tsx for why these boundaries exist. Nothing to seed from here: the
// pools are never cached, so the page's own loading state takes over the moment it mounts.
export default function Loading() {
  return (
    <RouteLoading>
      <h1 className="page-title">Drop Log</h1>
      <p className="party-hint">Loading...</p>
    </RouteLoading>
  );
}
