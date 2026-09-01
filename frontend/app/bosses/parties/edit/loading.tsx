import { RouteLoading } from "@/components/route-loading";

// See app/inventory/loading.tsx for why these boundaries exist.
export default function Loading() {
  return (
    <RouteLoading>
      <h1 className="page-title">Edit Parties</h1>
      <p className="party-hint">Loading...</p>
    </RouteLoading>
  );
}
