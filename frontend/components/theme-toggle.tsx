"use client";

import { useSyncExternalStore } from "react";

// Three states, not two: dark, light, and "whatever the OS says".
//
// A two-way toggle has to pick a starting side, and whichever it picks is wrong for half the
// people who arrive. Following the system until you say otherwise means the app is already right
// for most of them, and the moment you touch the toggle it stops guessing and does as it is told.
type Theme = "dark" | "light" | "system";
const KEY = "maplestorage-theme";

const NEXT: Record<Theme, Theme> = { system: "dark", dark: "light", light: "system" };
const LABEL: Record<Theme, string> = {
  system: "Match system",
  dark: "Dark",
  light: "Light",
};
const ICON: Record<Theme, string> = { system: "◐", dark: "☾", light: "☀" };

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}

// localStorage is an external store, so read it as one.
//
// Seeding state in an effect instead (setTheme on mount) works and lints as an error, correctly:
// it renders once with the wrong value and again with the right one. useSyncExternalStore renders
// the server's answer on the server and the browser's in the browser, with no second pass, and
// the inline script in layout.tsx has already put the right theme on <html> before any of this
// runs, so nothing is ever painted wrong.
const listeners = new Set<() => void>();

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function read(): Theme {
  const saved = localStorage.getItem(KEY);
  return saved === "dark" || saved === "light" ? saved : "system";
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, read, () => "system" as Theme);

  function cycle() {
    const next = NEXT[theme];
    if (next === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, next);
    applyTheme(next);
    listeners.forEach((fn) => fn());
  }

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={cycle}
      title={`Theme: ${LABEL[theme]}. Click for ${LABEL[NEXT[theme]].toLowerCase()}`}
      aria-label={`Theme: ${LABEL[theme]}. Click to switch to ${LABEL[NEXT[theme]]}.`}
    >
      <span aria-hidden="true">{ICON[theme]}</span>
    </button>
  );
}
