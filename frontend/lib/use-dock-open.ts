"use client";

import { useSyncExternalStore } from "react";
import { readDockOpen, writeDockOpen, type DockName } from "./dock-collapse";

// useSyncExternalStore, not useState, for the server snapshot: both pages render on the server,
// where the stored answer cannot be known. It hands hydration the open dock the server drew and
// then re-renders from storage, instead of tripping a hydration mismatch on the difference.

const cache: Partial<Record<DockName, boolean>> = {};
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Cached because getSnapshot must return the SAME value until something changes; reading storage
// on every render is allowed to return a fresh string, and React would loop on it.
function snapshot(name: DockName): boolean {
  return (cache[name] ??= readDockOpen(name));
}

export function useDockOpen(name: DockName): [boolean, (open: boolean) => void] {
  const open = useSyncExternalStore(
    subscribe,
    () => snapshot(name),
    () => true,
  );

  function setOpen(next: boolean) {
    cache[name] = next;
    writeDockOpen(name, next);
    for (const listener of listeners) listener();
  }

  return [open, setOpen];
}
