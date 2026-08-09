"use client";

import { useAuth } from "@clerk/nextjs";
import { useState } from "react";
import { apiFetch } from "@/lib/api";
import { setAccountSettings, SETTINGS_KEY, useAccountSettings } from "@/lib/use-account-settings";
import { WORLD_TYPES, worldShortLabel, type WorldType } from "@/lib/world";
import type { Settings } from "@/types/settings";

// Which world the site is answering for.
//
// In the header rather than on a settings page, because it is not a preference you set once. It
// says what every number on screen is a number of, so it belongs where the numbers are.

export function WorldToggle() {
  const settings = useAccountSettings();
  const { getToken } = useAuth();
  const [busy, setBusy] = useState(false);

  // Nothing to draw until the answer arrives. A default drawn here would be a claim about which
  // world you are in, made before anyone asked, and half of them would be wrong.
  if (!settings) return null;

  async function choose(world: WorldType) {
    if (busy || world === settings?.worldType) return;
    setBusy(true);
    try {
      const saved = await apiFetch<Settings>(
        SETTINGS_KEY,
        { method: "PUT", body: JSON.stringify({ worldType: world }) },
        getToken,
      );
      setAccountSettings(saved);
      // A reload, not a cache invalidation. Every list, count and total on screen was narrowed to
      // the old world by the server, and pages here fetch once on mount: clearing the cache would
      // leave the mounted page showing the other world's data with the toggle saying otherwise.
      // That is the exact failure this app exists to prevent, so the blunt instrument wins.
      window.location.reload();
    } catch {
      // Left as it was. The toggle is one click to retry, and an error line in the header would
      // outlive the moment it belongs to.
      setBusy(false);
    }
  }

  return (
    <span className="world-toggle" role="group" aria-label="World">
      {WORLD_TYPES.map((option) => (
        <button
          key={option}
          type="button"
          className={settings.worldType === option ? "world-tab active" : "world-tab"}
          aria-pressed={settings.worldType === option}
          disabled={busy}
          onClick={() => choose(option)}
        >
          {worldShortLabel(option)}
        </button>
      ))}
    </span>
  );
}
