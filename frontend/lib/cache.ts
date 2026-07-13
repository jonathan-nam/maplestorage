// A tiny stale-while-revalidate cache for GETs.
//
// The backend answers in ~1-8ms, so nothing here is about server load. It is about
// what the user sees. Navigating to /characters mounted a fresh component that showed
// "loading…", called getToken(), then fetched -- and it did all of that again every
// time you came back to a page you had just left. The data was almost always identical.
//
// So: render what we had immediately, and refresh in the background. A repeat visit
// paints instantly instead of flashing a loading state, and if the data did change the
// UI updates a moment later. The first visit is unchanged -- there is nothing to show
// yet, and pretending otherwise would just be lying faster.
//
// Deliberately not a library. SWR and TanStack Query are both good, and both are more
// machinery than this app needs. If the API grows a lot, replace this with one of
// them rather than growing this.

const entries = new Map<string, unknown>();

export function peek<T>(key: string): T | undefined {
  return entries.get(key) as T | undefined;
}

export function put<T>(key: string, value: T): void {
  entries.set(key, value);
}

/**
 * Drop cached entries whose key contains `fragment`.
 *
 * Call this after a write. Without it the cache is worse than no cache: adding a
 * character would show the old list on the next visit, which is a stale read that
 * looks exactly like a bug in the backend.
 */
export function invalidate(fragment: string): void {
  for (const key of entries.keys()) {
    if (key.includes(fragment)) entries.delete(key);
  }
}
