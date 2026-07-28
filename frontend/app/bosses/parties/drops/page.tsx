"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useEffect, useState } from "react";
import { apiAssetUrl, apiFetch } from "@/lib/api";
import { peek, put } from "@/lib/cache";
import { buildDropLog, forCharacter, type DropEntry, type DropMonth } from "@/lib/drop-log";
import { formatMesos } from "@/lib/drop-split";
import { formatDropped, statusLabel } from "@/lib/loot";
import { preloadBossArt } from "@/lib/preload-boss-art";
import { useAccountSettings } from "@/lib/use-account-settings";
import { showsMoney } from "@/lib/world";
import type { Boss } from "@/types/boss";
import type { Character } from "@/types/character";
import type { PartyLootPool } from "@/types/loot";
import type { Party } from "@/types/party";

// The history of what dropped, and what it made. Every meso is lib/drop-log.ts's, which is
// splitOf()'s, which is splitDrop()'s. Nothing here adds anything up.

type LoadState = "loading" | "loaded" | "error";

const PARTIES_KEY = "/api/parties";
const POOLS_KEY = "/api/parties/loot";
const BOSSES_KEY = "/api/bosses";
const CHARACTERS_KEY = "/api/characters";

export default function DropLogPage() {
  // Before anything is fetched: see lib/preload-boss-art.ts.
  preloadBossArt();

  const { getToken } = useAuth();
  // Read off "does any character trade", not off one world: this page sums across every party, so
  // one Interactive character means there is real money here to show. Only an account with none at
  // all gets the tiles dropped, and there its totals were three true zeroes.
  const money = showsMoney(useAccountSettings()?.trades);

  const [parties, setParties] = useState<Party[]>(peek<Party[]>(PARTIES_KEY) ?? []);
  const [pools, setPools] = useState<PartyLootPool[]>([]);
  const [bosses, setBosses] = useState<Boss[]>(peek<Boss[]>(BOSSES_KEY) ?? []);
  const [characters, setCharacters] = useState<Character[]>(
    peek<Character[]>(CHARACTERS_KEY) ?? [],
  );
  const [state, setState] = useState<LoadState>("loading");
  const [character, setCharacter] = useState<string | null>(null);

  useEffect(() => {
    // One token for the whole burst: getToken() can round-trip to Clerk.
    getToken()
      .then((token) => {
        const withToken = () => Promise.resolve(token);
        return Promise.all([
          apiFetch<Party[]>(PARTIES_KEY, { method: "GET" }, withToken),
          apiFetch<PartyLootPool[]>(POOLS_KEY, { method: "GET" }, withToken),
          apiFetch<Boss[]>(BOSSES_KEY, { method: "GET" }, withToken),
          apiFetch<Character[]>(CHARACTERS_KEY, { method: "GET" }, withToken),
        ]);
      })
      .then(([partyResult, poolResult, bossResult, characterResult]) => {
        setParties(partyResult);
        setPools(poolResult);
        setBosses(bossResult);
        setCharacters(characterResult);
        put(PARTIES_KEY, partyResult);
        put(BOSSES_KEY, bossResult);
        put(CHARACTERS_KEY, characterResult);
        setState("loaded");
      })
      // The pools are never cached, so there is nothing to fall back to.
      .catch(() => setState("error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const bossByKey = new Map(bosses.map((b) => [b.bossKey, b]));
  const characterById = new Map(characters.map((c) => [c.id, c]));
  const log = forCharacter(buildDropLog(parties, pools), character);
  const { totals } = log;

  // Only characters that actually have drops. A filter offering a name with nothing behind it
  // reads as a bug the first time it is picked.
  const withDrops = characters.filter((c) =>
    parties.some((p) => p.characterId === c.id && pools.some((pool) => pool.partyId === p.id)),
  );

  return (
    <main className="page">
      <p className="loot-back">
        <Link href="/bosses/parties">&larr; Party View</Link>
      </p>

      <h1 className="page-title">Drop Log</h1>

      {state === "error" && <p>Couldn&apos;t load your drops.</p>}
      {state === "loading" && <p className="party-hint">Loading...</p>}

      {state === "loaded" && (
        <>
          <div className="stat-row">
            <div className="stat-tile">
              <span className="stat-label">Drops</span>
              <span className="stat-value">{totals.drops}</span>
              <span className="stat-note">
                {totals.sold} sold
                {totals.pending > 0 && `, ${totals.pending} in the pool`}
              </span>
            </div>
            {money && (
              <>
                <div className="stat-tile">
                  <span className="stat-label">Sold for</span>
                  <span className="stat-value is-good">{formatMesos(totals.pooled, true)}</span>
                  {/* Labelled precisely, because the obvious reading of "total sales" is a number
                      that cannot be computed. See the header of lib/drop-log.ts. */}
                  <span className="stat-note">landed in inventories, fee off</span>
                </div>
                <div className="stat-tile">
                  <span className="stat-label">Your take</span>
                  <span className="stat-value is-good">{formatMesos(totals.yourTake, true)}</span>
                  <span className="stat-note">your share of the above</span>
                </div>
              </>
            )}
          </div>

          {withDrops.length > 1 && (
            <div className="party-toolbar">
              <label className="droplog-filter">
                <span className="stat-label">Character</span>
                <select
                  className="split-input"
                  value={character ?? ""}
                  onChange={(e) => setCharacter(e.target.value || null)}
                >
                  <option value="">All characters</option>
                  {withDrops.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}

          {totals.drops === 0 && (
            <p className="finder-empty">
              No drops logged yet. Open a party from <Link href="/bosses/parties">Party View</Link>{" "}
              and add what dropped.
            </p>
          )}

          {log.months.map((month) => (
            <MonthSection
              key={month.key}
              month={month}
              bossByKey={bossByKey}
              characterById={characterById}
              showCharacter={character === null}
              money={money}
            />
          ))}

          {totals.unreadable > 0 && (
            <p className="loot-warn droplog-note">
              {totals.unreadable} sold {totals.unreadable === 1 ? "drop names" : "drops name"} a
              seat that has left its party, so {totals.unreadable === 1 ? "its" : "their"} split
              cannot be read. {totals.unreadable === 1 ? "It is" : "They are"} listed below with no
              figures, and {totals.unreadable === 1 ? "its" : "their"} money is in neither total
              above.
            </p>
          )}
        </>
      )}
    </main>
  );
}

/** One month of the log, with what that month made on its heading. */
function MonthSection({
  month,
  bossByKey,
  characterById,
  showCharacter,
  money,
}: {
  month: DropMonth;
  bossByKey: Map<string, Boss>;
  characterById: Map<string, Character>;
  showCharacter: boolean;
  money: boolean;
}) {
  return (
    <section className="party-group">
      <header className="droplog-month-head">
        <h2 className="party-group-name">{month.label}</h2>
        {money && (
          <span className="droplog-month-total">
            {formatMesos(month.yourTake, true)}
            <span className="stat-label"> your take</span>
          </span>
        )}
      </header>
      <ul className="droplog-list">
        {month.entries.map((entry) => (
          <DropRow
            key={entry.lootId}
            entry={entry}
            boss={bossByKey.get(entry.bossKey ?? "") ?? null}
            characterName={characterById.get(entry.characterId)?.name ?? null}
            showCharacter={showCharacter}
          />
        ))}
      </ul>
    </section>
  );
}

function DropRow({
  entry,
  boss,
  characterName,
  showCharacter,
}: {
  entry: DropEntry;
  boss: Boss | null;
  characterName: string | null;
  showCharacter: boolean;
}) {
  const meta = [
    boss?.name,
    showCharacter ? characterName : null,
    formatDropped(entry.droppedOn),
    entry.sellerName ? `sold by ${entry.sellerName}` : null,
  ].filter(Boolean);

  return (
    <li className={`droplog-row status-${entry.status.toLowerCase()}`}>
      {entry.iconUrl ? (
        <img className="loot-icon" src={apiAssetUrl(entry.iconUrl)} alt="" />
      ) : (
        // No official art for this drop. An empty frame keeps the row aligned with the ones that
        // have it, as the loot pool does.
        <span className="loot-icon" aria-hidden="true" />
      )}

      <span className="droplog-title">
        <Link href={`/bosses/parties/${entry.partyId}`} className="loot-name">
          {entry.name}
        </Link>
        <span className="loot-meta">
          {boss?.iconUrl && (
            <img className="boss-portrait is-small" src={apiAssetUrl(boss.iconUrl)} alt="" />
          )}
          {meta.join(" · ")}
        </span>
      </span>

      {entry.unreadable ? (
        <span className="droplog-amounts">
          <span className="loot-share-nets">split unreadable</span>
        </span>
      ) : entry.pooled === null ? (
        <span className="droplog-amounts">
          <span className={`loot-status is-${entry.status.toLowerCase()}`}>
            {statusLabel(entry.status)}
          </span>
        </span>
      ) : (
        <span className="droplog-amounts">
          <span className="droplog-take">{formatMesos(entry.yourTake ?? 0, true)}</span>
          <span className="loot-share-nets">of {formatMesos(entry.pooled, true)}</span>
        </span>
      )}
    </li>
  );
}
