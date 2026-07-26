// Title only, and it exists for the same reason /bosses/split's does: without it this route
// inherits app/bosses/loading.tsx and flashes the boss-clear matrix skeleton, which is not the
// page that is coming.

export default function Loading() {
  return (
    <main className="page">
      <h1 className="page-title">Run Order</h1>
    </main>
  );
}
