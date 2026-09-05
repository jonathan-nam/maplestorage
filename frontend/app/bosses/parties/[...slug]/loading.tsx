import { RouteLoading } from "@/components/route-loading";

// See app/bosses/loading.tsx for why these boundaries exist. The party's name is not known
// server side, so this is the frame without it rather than a guessed title.
export default function Loading() {
  return (
    <RouteLoading>
      <p className="party-hint">Loading...</p>
    </RouteLoading>
  );
}
