import { RouteLoading } from "@/components/route-loading";

// See app/bosses/loading.tsx for why these boundaries exist. A menu destination without one
// cannot show anything until its own JS has mounted, however early the route was prefetched.
//
// The chrome mirrors app/characters/page.tsx, down to the hint it shows for its own fetch, so
// handing over to the page is invisible. The "Look up N worlds" button is not drawn: it is
// conditional on data this boundary does not have, and guessing it wrong would move the title.
export default function Loading() {
  return (
    <RouteLoading>
      <div className="settings-section-head">
        <h1 className="page-title">Characters</h1>
      </div>
      <p className="party-hint">Loading...</p>
    </RouteLoading>
  );
}
