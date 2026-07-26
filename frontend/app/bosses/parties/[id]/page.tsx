"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { LootPool } from "@/components/loot-pool";
import { SeatChip } from "@/components/seat-chip";
import { apiAssetUrl } from "@/lib/api";
import { preloadBossArt } from "@/lib/preload-boss-art";
import { ApiError, apiFetch } from "@/lib/api";
import { peek, put } from "@/lib/cache";
import { summarize } from "@/lib/loot";
import { otherMembers, partySizeLabel } from "@/lib/parties";
import type { Boss } from "@/types/boss";
import type { DropTables } from "@/types/drop";
import type { AddLootBody, Loot, SellLootBody } from "@/types/loot";
import type { Party } from "@/types/party";

type LoadState = "loading" | "loaded" | "error";

const BOSSES_KEY = "/api/bosses";
const DROPS_KEY = "/api/bosses/drops";

export default function PartyPage() {
  // Before anything is fetched: see lib/preload-boss-art.ts.
  preloadBossArt();

  const { getToken } = useAuth();
  const params = useParams<{ id: string }>();
  const partyId = params.id;

  const [party, setParty] = useState<Party | null>(null);
  const [loot, setLoot] = useState<Loot[]>([]);
  const [bosses, setBosses] = useState<Boss[]>(peek<Boss[]>(BOSSES_KEY) ?? []);
  const [dropTables, setDropTables] = useState<DropTables>(peek<DropTables>(DROPS_KEY) ?? {});
  const [state, setState] = useState<LoadState>("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const partyUrl = `/api/parties/${partyId}`;
  const lootUrl = `${partyUrl}/loot`;

  async function loadLoot(token?: string | null) {
    const result = await apiFetch<Loot[]>(
      lootUrl,
      { method: "GET" },
      token !== undefined ? () => Promise.resolve(token) : getToken,
    );
    setLoot(result);
  }

  useEffect(() => {
    getToken()
      .then((token) => {
        const withToken = () => Promise.resolve(token);
        return Promise.all([
          apiFetch<Party>(partyUrl, { method: "GET" }, withToken),
          loadLoot(token),
          apiFetch<Boss[]>(BOSSES_KEY, { method: "GET" }, withToken),
          // The whole catalog's drop tables, cached: it is a few dozen rows and the picker needs
          // whichever boss you switch to next.
          apiFetch<DropTables>(DROPS_KEY, { method: "GET" }, withToken),
        ]);
      })
      .then(([partyResult, , bossResult, dropResult]) => {
        setParty(partyResult);
        setBosses(bossResult);
        setDropTables(dropResult);
        put(BOSSES_KEY, bossResult);
        put(DROPS_KEY, dropResult);
        setState("loaded");
      })
      .catch(() => setState("error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partyId]);

  // Every mutation refetches the pool rather than patching it in place: status is derived from the
  // sale and the payout rows server side, so the server's answer is the only one that is right.
  async function mutate(path: string, options: RequestInit) {
    setBusy(true);
    setError(null);
    try {
      await apiFetch<unknown>(path, options, getToken);
      await loadLoot();
    } catch (e) {
      setError(e instanceof ApiError ? e.body : "That didn't save.");
    } finally {
      setBusy(false);
    }
  }

  const add = (body: AddLootBody) =>
    mutate(lootUrl, { method: "POST", body: JSON.stringify(body) });
  const sell = (lootId: string, body: SellLootBody) =>
    mutate(`${lootUrl}/${lootId}/sale`, { method: "PUT", body: JSON.stringify(body) });
  const unsell = (lootId: string) => mutate(`${lootUrl}/${lootId}/sale`, { method: "DELETE" });
  const setPaid = (lootId: string, memberId: string, paid: boolean) =>
    mutate(`${lootUrl}/${lootId}/payouts/${memberId}`, {
      method: "PUT",
      body: JSON.stringify({ paid }),
    });
  const remove = (lootId: string) => mutate(`${lootUrl}/${lootId}`, { method: "DELETE" });

  const bossByKey = new Map(bosses.map((b) => [b.bossKey, b]));
  // Counted from the rows on screen rather than from the party's stored counters, which were read
  // one request earlier and go stale the moment something here is marked paid.
  const summary = summarize(loot);

  return (
    <main className="page">
      <p className="loot-back">
        <Link href="/bosses/parties">&larr; Parties</Link>
      </p>

      {state === "error" && <p>Couldn&apos;t load that party.</p>}
      {state === "loading" && <p className="party-hint">Loading...</p>}

      {state === "loaded" && party && (
        <>
          {/* The boss and the roster ARE the title: there is nothing else it could be called. */}
          <h1 className="page-title">
            {bossByKey.get(party.bossKey)?.name ?? party.bossKey} with{" "}
            {otherMembers(party)
              .map((m) => m.name)
              .join(", ")}
          </h1>
          <div className="party-card-head">
            <ul className="party-roster">
              {party.members.map((member) => (
                <SeatChip key={member.id} member={member} />
              ))}
            </ul>
            <span className="party-card-size">{partySizeLabel(party.members.length)}</span>
          </div>

          <ul className="party-bosses">
            <li>
              {bossByKey.get(party.bossKey)?.iconUrl && (
                <img
                  className="boss-portrait"
                  src={apiAssetUrl(bossByKey.get(party.bossKey)!.iconUrl!)}
                  alt=""
                />
              )}
              {bossByKey.get(party.bossKey)?.name ?? party.bossKey}
            </li>
          </ul>

          {(summary.pending > 0 || summary.awaitingPayout > 0) && (
            <p className="party-loot-summary">
              {[
                summary.pending > 0 ? `${summary.pending} in the pool` : null,
                summary.awaitingPayout > 0 ? `${summary.awaitingPayout} awaiting payout` : null,
              ]
                .filter(Boolean)
                .join(" \u00b7 ")}
            </p>
          )}

          {error && <p className="split-error">{error}</p>}

          <LootPool
            party={party}
            loot={loot}
            dropTables={dropTables}
            bossByKey={bossByKey}
            busy={busy}
            onAdd={add}
            onSell={sell}
            onUnsell={unsell}
            onSetPaid={setPaid}
            onDelete={remove}
          />
        </>
      )}
    </main>
  );
}
