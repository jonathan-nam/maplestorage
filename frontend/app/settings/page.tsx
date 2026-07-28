"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import { ApiError, apiFetch } from "@/lib/api";
import { SETTINGS_KEY, setWorldType, useWorldType } from "@/lib/use-world-type";
import { worldLabel, WORLD_TYPES, type WorldType } from "@/lib/world";
import type { Settings } from "@/types/settings";

export default function SettingsPage() {
  const { getToken } = useAuth();

  // The store already holds it once anything has asked, and the header asks on every page, so
  // there is no separate "loaded" to track: having the world IS being loaded.
  const world = useWorldType();
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (world) return;
    apiFetch<Settings>(SETTINGS_KEY, { method: "GET" }, getToken)
      .then((settings) => setWorldType(settings.worldType))
      .catch(() => setFailed(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world]);

  async function choose(next: WorldType) {
    if (next === world) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await apiFetch<Settings>(
        SETTINGS_KEY,
        { method: "PUT", body: JSON.stringify({ worldType: next }) },
        getToken,
      );
      setWorldType(saved.worldType);
    } catch (e) {
      setError(e instanceof ApiError ? e.body : "Couldn't save that.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page">
      <h1 className="page-title">Settings</h1>

      {!world && failed && <p>Couldn&apos;t load your settings.</p>}
      {!world && !failed && <p className="party-hint">Loading...</p>}

      {world && (
        <div className="setting-row">
          <span className="setting-label" id="world-label">
            World
          </span>
          <div className="basis-row" role="group" aria-labelledby="world-label">
            {WORLD_TYPES.map((option) => (
              <button
                key={option}
                type="button"
                className={world === option ? "basis-tab active" : "basis-tab"}
                aria-pressed={world === option}
                disabled={busy}
                onClick={() => choose(option)}
              >
                {worldLabel(option)}
              </button>
            ))}
          </div>
        </div>
      )}

      {error && <p className="routine-error">{error}</p>}
    </main>
  );
}
