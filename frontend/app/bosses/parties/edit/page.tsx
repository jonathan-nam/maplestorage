"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useEffect, useState } from "react";
import { PartyGridEditor } from "@/components/party-grid-editor";
import { ApiError, apiFetch } from "@/lib/api";
import { peek, put } from "@/lib/cache";
import { preloadBossArt } from "@/lib/preload-boss-art";
import type { Boss } from "@/types/boss";
import type { PartyGrid, SaveGridBody } from "@/types/party";

type LoadState = "loading" | "loaded" | "error";

const GRID_KEY = "/api/parties/grid";
const BOSSES_KEY = "/api/bosses";

// Editing the roster, on its own page. The Parties page answers "what are my parties"; this one
// answers "change them", and the two want different shapes: a dense grid to type into, against a
// list to read.
export default function EditPartiesPage() {
  // Before anything is fetched: see lib/preload-boss-art.ts.
  preloadBossArt();

  const { getToken } = useAuth();
  const seededGrid = peek<PartyGrid>(GRID_KEY);
  const seededBosses = peek<Boss[]>(BOSSES_KEY);

  const [grid, setGrid] = useState<PartyGrid>(seededGrid ?? { people: [], parties: [] });
  const [bosses, setBosses] = useState<Boss[]>(seededBosses ?? []);
  const [state, setState] = useState<LoadState>(seededGrid && seededBosses ? "loaded" : "loading");
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    getToken()
      .then((token) => {
        const withToken = () => Promise.resolve(token);
        return Promise.all([
          apiFetch<PartyGrid>(GRID_KEY, { method: "GET" }, withToken),
          apiFetch<Boss[]>(BOSSES_KEY, { method: "GET" }, withToken),
        ]);
      })
      .then(([gridResult, bossResult]) => {
        setGrid(gridResult);
        setBosses(bossResult);
        put(GRID_KEY, gridResult);
        put(BOSSES_KEY, bossResult);
        setState("loaded");
      })
      // Only blank the page if there is nothing to show: a failed refresh behind data we already
      // have should leave that data up.
      .catch(() => setState((s) => (s === "loaded" ? "loaded" : "error")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(body: SaveGridBody) {
    setBusy(true);
    setSaveError(null);
    try {
      const saved = await apiFetch<PartyGrid>(
        GRID_KEY,
        { method: "PUT", body: JSON.stringify(body) },
        getToken,
      );
      // The server's answer, not the draft: it decides seat ids, person ids and boss order, and a
      // grid assembled here would be a second answer to what was just saved.
      setGrid(saved);
      put(GRID_KEY, saved);
    } catch (e) {
      // The backend refuses a bad grid with the reason in the body (see validateGrid). Showing it
      // beats "something went wrong" for the one thing the user can actually fix.
      setSaveError(e instanceof ApiError ? e.body : "Couldn't save the grid.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page">
      <p className="loot-back">
        <Link href="/bosses/parties">&larr; Parties</Link>
      </p>
      <h1 className="page-title">Edit parties</h1>
      <p className="split-intro">
        A column per person, a row per party, and the character they bring in the cell. A blank cell
        means they sat that one out.
      </p>

      {state === "error" && <p>Couldn&apos;t load your parties.</p>}
      {state === "loading" && <p className="party-hint">Loading...</p>}

      {state === "loaded" && (
        <PartyGridEditor
          // Remounted when the server's grid changes, so the draft starts from what was saved
          // rather than from a stale copy of it.
          key={grid.parties.map((p) => p.id).join() + grid.people.map((p) => p.id).join()}
          grid={grid}
          bosses={bosses}
          busy={busy}
          error={saveError}
          onSave={save}
        />
      )}
    </main>
  );
}
