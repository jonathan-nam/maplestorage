"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useEffect, useState } from "react";
import { LogDrop } from "@/components/log-drop";
import { ApiError, apiAssetUrl, apiFetch } from "@/lib/api";
import { peek, put } from "@/lib/cache";
import {
  buildDropLog,
  forCharacter,
  groupDrops,
  type DropEntry,
  type DropGroup,
  type Grouping,
} from "@/lib/drop-log";
import { formatMesos } from "@/lib/drop-split";
import { formatDropped, statusLabel } from "@/lib/loot";
import { useAccountSettings } from "@/lib/use-account-settings";
import { showsMoney } from "@/lib/world";
import type { Boss } from "@/types/boss";
import type { Character } from "@/types/character";
import type { DropTables } from "@/types/drop";
import type { LogDropBody, PartyLootPool } from "@/types/loot";
import type { Party } from "@/types/party";

// The history of what dropped, and what it made, and where a drop is logged. Every meso is
// lib/drop-log.ts's, which is splitOf()'s, which is splitDrop()'s. Nothing here adds anything up.

type LoadState = "loading" | "loaded" | "error";

// Solo pools included, and retired configs too, which only the wallet also asks for: both hold
// drops whose configs are off every list, and buildDropLog skips a pool whose config it cannot
// find, so without these the log would quietly be missing them. See partiesFor.
const PARTIES_KEY = "/api/parties?solo=include&retired=include";
const POOLS_KEY = "/api/parties/loot";
const BOSSES_KEY = "/api/bosses";
const DROPS_KEY = "/api/bosses/drops";
const CHARACTERS_KEY = "/api/characters";

export default function DropLogPage() {
  const { getToken } = useAuth();
  // Read off "does any character trade", not off one world: this page sums across every party, so
  // one Interactive character means there is real money here to show. Only an account with none at
  // all gets the tiles dropped, and there its totals were three true zeroes.
  const money = showsMoney(useAccountSettings()?.trades);

  const [parties, setParties] = useState<Party[]>(peek<Party[]>(PARTIES_KEY) ?? []);
  const [pools, setPools] = useState<PartyLootPool[]>([]);
  const [bosses, setBosses] = useState<Boss[]>(peek<Boss[]>(BOSSES_KEY) ?? []);
  const [dropTables, setDropTables] = useState<DropTables>(peek<DropTables>(DROPS_KEY) ?? {});
  const [characters, setCharacters] = useState<Character[]>(
    peek<Character[]>(CHARACTERS_KEY) ?? [],
  );
  const [state, setState] = useState<LoadState>("loading");
  const [character, setCharacter] = useState<string | null>(null);
  const [grouping, setGrouping] = useState<Grouping>("month");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(token?: string | null) {
    const withToken = token !== undefined ? () => Promise.resolve(token) : getToken;
    const [partyResult, poolResult] = await Promise.all([
      apiFetch<Party[]>(PARTIES_KEY, { method: "GET" }, withToken),
      apiFetch<PartyLootPool[]>(POOLS_KEY, { method: "GET" }, withToken),
    ]);
    setParties(partyResult);
    setPools(poolResult);
    put(PARTIES_KEY, partyResult);
  }

  useEffect(() => {
    // One token for the whole burst: getToken() can round-trip to Clerk.
    getToken()
      .then((token) => {
        const withToken = () => Promise.resolve(token);
        return Promise.all([
          load(token),
          apiFetch<Boss[]>(BOSSES_KEY, { method: "GET" }, withToken),
          // The whole catalog's drop tables, as the party page fetches them: a few dozen rows, and
          // the picker needs whichever boss is chosen next.
          apiFetch<DropTables>(DROPS_KEY, { method: "GET" }, withToken),
          apiFetch<Character[]>(CHARACTERS_KEY, { method: "GET" }, withToken),
        ]);
      })
      .then(([, bossResult, dropResult, characterResult]) => {
        setBosses(bossResult);
        setDropTables(dropResult);
        setCharacters(characterResult);
        put(BOSSES_KEY, bossResult);
        put(DROPS_KEY, dropResult);
        put(CHARACTERS_KEY, characterResult);
        setState("loaded");
      })
      // The pools are never cached, so there is nothing to fall back to.
      .catch(() => setState("error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Logs the drop, then reads the log back.
   *
   * Both lists, not just the pools: a drop on a boss run alone opens a config for it, and without
   * that config the drop has no seats to be read against and would not appear at all.
   */
  async function logDrop(body: LogDropBody) {
    setBusy(true);
    setError(null);
    try {
      await apiFetch<unknown>(
        "/api/parties/loot",
        { method: "POST", body: JSON.stringify(body) },
        getToken,
      );
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.body : "That didn't save.");
      throw e;
    } finally {
      setBusy(false);
    }
  }

  const bossByKey = new Map(bosses.map((b) => [b.bossKey, b]));
  const characterById = new Map(characters.map((c) => [c.id, c]));
  // The whole log is kept alongside the filtered one so the toolbar does not come and go: which
  // controls exist is a property of the account, not of what the filter currently leaves.
  const whole = buildDropLog(parties, pools);
  const log = forCharacter(whole, character);
  const { totals } = log;
  const groups = groupDrops(log.entries, grouping);

  // Only characters that actually have drops. A filter offering a name with nothing behind it
  // reads as a bug the first time it is picked.
  const withDrops = characters.filter((c) =>
    parties.some((p) => p.characterId === c.id && pools.some((pool) => pool.partyId === p.id)),
  );

  return (
    <main className="page">
      <h1 className="page-title">Drop Log</h1>

      {state === "error" && <p>Couldn&apos;t load your drops.</p>}
      {state === "loading" && <p className="party-hint">Loading...</p>}

      {state === "loaded" && (
        <>
          {/* Above the totals it changes. Nothing to log against with no roster, and a picker of
              nobody is not worth holding the space for. */}
          {characters.length > 0 && (
            <LogDrop
              characters={characters}
              parties={parties}
              bosses={bosses}
              dropTables={dropTables}
              busy={busy}
              onLog={logDrop}
            />
          )}
          {error && <p className="split-error">{error}</p>}

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
                  <span className="stat-note">what there was to split</span>
                </div>
                <div className="stat-tile">
                  <span className="stat-label">Your take</span>
                  <span className="stat-value is-good">{formatMesos(totals.yourTake, true)}</span>
                  <span className="stat-note">your share of the above</span>
                </div>
              </>
            )}
          </div>

          {whole.totals.drops > 0 && (
            <div className="party-toolbar">
              {withDrops.length > 1 && (
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
              )}

              <label className="droplog-filter">
                <span className="stat-label">Group</span>
                <select
                  className="split-input"
                  value={grouping}
                  onChange={(e) => setGrouping(e.target.value as Grouping)}
                >
                  <option value="month">Month</option>
                  <option value="week">Week</option>
                </select>
              </label>
            </div>
          )}

          {/* The form to fix it is directly above, so this says what is here and nothing else. */}
          {totals.drops === 0 && <p className="finder-empty">No drops logged yet.</p>}

          {groups.map((group) => (
            <GroupSection
              key={group.key}
              group={group}
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

/** One month or one week of the log, with what it made on its heading. */
function GroupSection({
  group,
  bossByKey,
  characterById,
  showCharacter,
  money,
}: {
  group: DropGroup;
  bossByKey: Map<string, Boss>;
  characterById: Map<string, Character>;
  showCharacter: boolean;
  money: boolean;
}) {
  return (
    <section className="party-group">
      <header className="droplog-group-head">
        <h2 className="party-group-name">{group.label}</h2>
        {money && (
          <span className="droplog-group-total">
            {formatMesos(group.yourTake, true)}
            <span className="stat-label"> your take</span>
          </span>
        )}
      </header>
      <ul className="droplog-list">
        {group.entries.map((entry) => (
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
    entry.sellerName
      ? `${entry.amountBasis === "BOUGHT" ? "bought by" : "sold by"} ${entry.sellerName}`
      : null,
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
        <span className="loot-meta">{meta.join(" · ")}</span>
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
