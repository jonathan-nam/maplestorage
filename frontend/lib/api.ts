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

  const token = await getToken();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });

  if (!response.ok) {
    throw new ApiError(response.status, await response.text());
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}
