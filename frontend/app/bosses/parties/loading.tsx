import { RouteLoading } from "@/components/route-loading";

// See app/inventory/loading.tsx for why these boundaries exist. Nothing to seed from here: this
// renders on the server, and the page's own loading state takes over the moment it mounts.
export default function Loading() {
  return (
    <RouteLoading>
      <h1 className="page-title">Party View</h1>
      <p className="party-hint">Loading...</p>
    </RouteLoading>
  );
}
