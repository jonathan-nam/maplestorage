import { record, serverTimeFromHeader } from "./timing";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL;

// For public, unauthenticated assets (token icons) that don't go through
// apiFetch's Bearer-token JSON flow -- just resolves a backend-relative path
// (e.g. "/token-icons/foo.png") to an absolute URL.
export function apiAssetUrl(path: string): string {
  return `${API_BASE_URL ?? ""}${path}`;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`API request failed (${status}): ${body}`);
  }
}

// Wraps the fetch + Authorization: Bearer pattern already used in
// backend-status.tsx so it isn't copy-pasted per call site. Takes getToken
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
  // single call -- and it was completely invisible until we measured it.
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
