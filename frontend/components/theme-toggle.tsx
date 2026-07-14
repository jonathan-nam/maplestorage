"use client";

import { useSyncExternalStore } from "react";

// Two states: dark and light. First load still follows the OS (the inline script in layout.tsx
// leaves data-theme unset when nothing is stored, and the media query in globals.css paints to
// match), so the app is already right for most people who arrive. The toggle itself only ever
// flips between the two explicit themes, it does not offer a "match system" stop.
type Theme = "dark" | "light";
const KEY = "maplestorage-theme";

const NEXT: Record<Theme, Theme> = { dark: "light", light: "dark" };
const LABEL: Record<Theme, string> = { dark: "Dark", light: "Light" };
const ICON: Record<Theme, string> = { dark: "☾", light: "☀" };

export function applyTheme(theme: Theme) {
  const root = document.documentElement;

  // Swap the palette with transitions off for one frame, so colour-transitioned elements snap
  // instead of cross-fading (see .theme-instant in globals.css). The reflow commits the new colours
  // at their target before transitions come back, so hovers still animate afterwards.
  root.classList.add("theme-instant");
  root.setAttribute("data-theme", theme);
  void root.offsetHeight;
  root.classList.remove("theme-instant");
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
  // Until the first click nothing is stored and the icon tracks the OS, so keep it right if the
  // OS theme flips while the page is open.
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", fn);
  return () => {
    listeners.delete(fn);
    mq.removeEventListener("change", fn);
  };
}

function read(): Theme {
  const saved = localStorage.getItem(KEY);
  if (saved === "dark" || saved === "light") return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, read, () => "dark" as Theme);

  function toggle() {
    const next = NEXT[theme];
    localStorage.setItem(KEY, next);
    applyTheme(next);
    listeners.forEach((fn) => fn());
  }

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      title={`Theme: ${LABEL[theme]}. Click for ${LABEL[NEXT[theme]].toLowerCase()}`}
      aria-label={`Theme: ${LABEL[theme]}. Click to switch to ${LABEL[NEXT[theme]]}.`}
    >
      <span aria-hidden="true">{ICON[theme]}</span>
    </button>
  );
}
