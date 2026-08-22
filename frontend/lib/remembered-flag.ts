"use client";

// A tick box on the Run Order page that survives a reload.
//
// Two of them now, and both mean the same thing to storage: on unless it was explicitly turned off,
// and anything else stored under the key is on. Kept in one place so the second cannot drift from
// the first over which word means off, or over what a blocked storage does.

import { useSyncExternalStore } from "react";

export type StorageLike = Pick<Storage, "getItem" | "setItem">;

function browserStorage(): StorageLike | null {
  // Reading the property itself throws when the browser blocks storage, so this is not the same
  // check as `typeof window`.
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export type RememberedFlag = {
  read: (store?: StorageLike | null) => boolean;
  write: (on: boolean, store?: StorageLike | null) => void;
  useFlag: () => [boolean, (on: boolean) => void];
};

/** One preference, on by default, under its own key. */
export function rememberedFlag(key: string): RememberedFlag {
  // useSyncExternalStore, not useState, for the server snapshot: the page prerenders where the
  // stored answer cannot be known. Hydration gets the on page the server drew and re-renders from
  // storage, instead of tripping a mismatch on the difference. Same reasoning as use-dock-open.ts.
  const listeners = new Set<() => void>();
  // Cached because getSnapshot must return the SAME value until something changes.
  let cached: boolean | null = null;

  function read(store: StorageLike | null = browserStorage()): boolean {
    try {
      return store?.getItem(key) !== "off";
    } catch {
      return true;
    }
  }

  function write(on: boolean, store: StorageLike | null = browserStorage()): void {
    try {
      store?.setItem(key, on ? "on" : "off");
    } catch {
      // A preference that cannot be saved is not worth failing the click over.
    }
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function snapshot(): boolean {
    return (cached ??= read());
  }

  function serverSnapshot(): boolean {
    return true;
  }

  function set(next: boolean) {
    cached = next;
    write(next);
    for (const listener of listeners) listener();
  }

  function useFlag(): [boolean, (on: boolean) => void] {
    return [useSyncExternalStore(subscribe, snapshot, serverSnapshot), set];
  }

  return { read, write, useFlag };
}
