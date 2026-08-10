import { RouteLoading, WaitingNote } from "@/components/route-loading";

// See app/inventory/loading.tsx for why these boundaries exist. The party's name is not known
// server side, so this is the frame without it rather than a guessed title.
export default function Loading() {
  return (
    <RouteLoading>
      <WaitingNote />
    </RouteLoading>
  );
}
