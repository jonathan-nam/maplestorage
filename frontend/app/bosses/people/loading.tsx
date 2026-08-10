import { RouteLoading, WaitingNote } from "@/components/route-loading";
import Link from "next/link";

// See app/inventory/loading.tsx. Mirrors app/bosses/people/page.tsx, hint included, so handing
// over to the page is invisible.
export default function Loading() {
  return (
    <RouteLoading>
      <p className="loot-back">
        <Link href="/bosses/parties/edit">&larr; Edit parties</Link>
      </p>
      <h1 className="page-title">People</h1>
      <WaitingNote />
    </RouteLoading>
  );
}
