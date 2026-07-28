"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect, useSyncExternalStore } from "react";
import { apiFetch } from "./api";
import type { Settings } from "@/types/settings";

// The account's settings, shared by every component that asks for them.
//
// A module store rather than the SWR cache in lib/cache.ts, because this one has to PUSH: the
// settings page changes a character's world and the header is already mounted, so a cache the
// header only reads on mount would leave the menu offering a tool the account just said it has no
// use for.

export const SETTINGS_KEY = "/api/settings";

let current: Settings | undefined;
const listeners = new Set<() => void>();

/** Called by whoever learns the answer: the fetch below, or the settings page after it writes. */
export function setAccountSettings(settings: Settings): void {
  if (current?.worldType === settings.worldType && current?.trades === settings.trades) return;
  current = settings;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The account's settings, or undefined until they are known.
 *
 * Undefined is not a third state to render. It means "not answered yet", and every caller has to
 * decide what to do in that moment rather than assume an answer.
 */
export function useAccountSettings(): Settings | undefined {
  const { getToken, isSignedIn } = useAuth();
  const settings = useSyncExternalStore(
    subscribe,
    () => current,
    () => undefined,
  );

  useEffect(() => {
    if (!isSignedIn || current !== undefined) return;
    // Swallowed on purpose. This decides what a menu lists, so a failed read leaves the menu as it
    // was rather than putting an error on screen for something the user did not ask for.
    apiFetch<Settings>(SETTINGS_KEY, { method: "GET" }, getToken)
      .then(setAccountSettings)
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn]);

  return settings;
}
