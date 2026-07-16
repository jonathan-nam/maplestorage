import { record, serverTimeFromHeader } from "./timing";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL;

// Public, unauthenticated assets: the item icons and the client's digit sprites. that don't go through
// apiFetch's Bearer-token JSON flow, just resolves a backend-relative path
// (e.g. "/token-icons/foo.png") to an absolute URL.
//
// Stamped with a build version (see next.config.ts) so a regenerated icon or digit sprite gets a
// fresh URL and cannot be masked by the day-long cache the backend sets on these, without which a
// changed asset silently serves stale for up to 24h.
const ASSET_VERSION = process.env.NEXT_PUBLIC_ASSET_VERSION;

export function apiAssetUrl(path: string): string {
  const url = `${API_BASE_URL ?? ""}${path}`;
  if (!ASSET_VERSION) return url;
  return `${url}${path.includes("?") ? "&" : "?"}v=${ASSET_VERSION}`;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`API request failed (${status}): ${body}`);
  }
}

// Wraps the fetch + Authorization: Bearer pattern so it is not copy-pasted per
// call site. Takes getToken
// as a plain function argument (from useAuth()) rather than calling the
// hook itself, so this can be called from event handlers (form submit,
// delete click) as well as effects.
export async function apiFetch<T>(
  path: string,
  options: RequestInit,
  getToken: () => Promise<string | null>,
): Promise<T> {
  if (!API_BASE_URL) {
    throw new Error("NEXT_PUBLIC_API_BASE_URL is not set");
  }

  // getToken() is timed separately from the fetch on purpose. It happens BEFORE the
  // request goes out, so whatever it costs is latency the user waits through on every
  // single call, and it was completely invisible until we measured it.
  const startedAt = performance.now();
  const token = await getToken();
  const authMs = performance.now() - startedAt;

  const fetchedAt = performance.now();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });
  const roundTripMs = performance.now() - fetchedAt;

  const serverMs = serverTimeFromHeader(response);
  record({
    label: `${options.method ?? "GET"} ${path}`,
    totalMs: performance.now() - startedAt,
    authMs,
    serverMs,
    netMs: serverMs === undefined ? undefined : roundTripMs - serverMs,
  });

  if (!response.ok) {
    throw new ApiError(response.status, await response.text());
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}
