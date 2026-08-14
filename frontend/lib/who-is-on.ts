"use client";

// Who is on tonight, remembered across visits. The roster is everyone you run with, which most
// nights is not everyone who is on, so without this the same people get unticked every time.
//
// The people who are AWAY are what gets stored. Somebody who joins a party later is then on by
// default, where storing the ones who are on would have left them out of a plan built before they
// existed, and left them out silently.

import { useSyncExternalStore } from "react";

export const AWAY_KEY = "sharpeyes.run-order.away";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

/** Shared so a read that finds nothing returns the same array every time. See snapshot(). */
const NOBODY: string[] = [];

function browserStorage(): StorageLike | null {
  // Reading the property itself throws when the browser blocks storage, so this is not the same
  // check as `typeof window`.
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Everyone is on until somebody has been ticked off, which is what the page did before it remembered. */
export function readAway(store: StorageLike | null = browserStorage()): string[] {
  try {
    const raw = store?.getItem(AWAY_KEY);
    if (raw === null || raw === undefined) return NOBODY;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return NOBODY;
    const ids = parsed.filter((id): id is string => typeof id === "string");
    return ids.length === 0 ? NOBODY : ids;
  } catch {
    // Junk from another tab or an older build is not a reason to plan a night without anybody.
    return NOBODY;
  }
}

export function writeAway(ids: string[], store: StorageLike | null = browserStorage()): void {
  try {
    store?.setItem(AWAY_KEY, JSON.stringify(ids));
  } catch {
    // A preference that cannot be saved is not worth failing the click over.
  }
}

// useSyncExternalStore, not useState, for the server snapshot: the page prerenders where the stored
// answer cannot be known. Same reasoning as lib/show-times.ts.
const listeners = new Set<() => void>();

// Cached because getSnapshot must return the SAME array until something changes.
let cached: string[] | null = null;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): string[] {
  return (cached ??= readAway());
}

function serverSnapshot(): string[] {
  return NOBODY;
}

export function useWhoIsOn(): [string[], (away: string[]) => void] {
  const away = useSyncExternalStore(subscribe, snapshot, serverSnapshot);

  function setAway(next: string[]) {
    cached = next;
    writeAway(next);
    for (const listener of listeners) listener();
  }

  return [away, setAway];
}
