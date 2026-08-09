"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { Fragment, useEffect, useState } from "react";
import { LogDrop } from "@/components/log-drop";
import { LotSale } from "@/components/lot-sale";
import { PieceLedger } from "@/components/piece-ledger";
import { StackArrangement } from "@/components/stack-arrangement";
import { ApiError, apiAssetUrl, apiFetch } from "@/lib/api";
import { peek, put } from "@/lib/cache";
import {
  buildDropLog,
  forCharacter,
  groupDrops,
  type DropLine,
  consolidate,
  dropStatusLabel,
  foldNames,
  type DropEntry,
  type DropGroup,
  type Grouping,
} from "@/lib/drop-log";
import { formatMesos } from "@/lib/drop-split";
import { formatDropped } from "@/lib/loot";
import { type LotSaleBody, fungibleDropKeys, lotDrops } from "@/lib/lot-sale";
import { useAccountSettings } from "@/lib/use-account-settings";
import {
  type Holder,
  SELF_KEY,
  holderKey,
  holderLedgers,
  outstanding,
  runningBalance,
  salesByHolder,
  unanswered,
} from "@/lib/vestige-ledger";
import { showsMoney } from "@/lib/world";
import type { Boss } from "@/types/boss";
import type { Character } from "@/types/character";
import type { DropTables } from "@/types/drop";
import type { Loot, LogDropBody, PartyLootPool } from "@/types/loot";
import type { Party } from "@/types/party";
import type { VestigeTranche } from "@/types/vestige";

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
const TRANCHES_KEY = "/api/vestige-tranches";

// The stacking drop the piece ledger is for. One key, because one item behaves this way: a boss
// drops it in bundles that do not divide by looting alone. See lib/piece-ledger.ts.
const VESTIGE = "vestige-of-erion";

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
  const [tranches, setTranches] = useState<VestigeTranche[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [character, setCharacter] = useState<string | null>(null);
  const [grouping, setGrouping] = useState<Grouping>("month");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(token?: string | null) {
    const withToken = token !== undefined ? () => Promise.resolve(token) : getToken;
    const [partyResult, poolResult, trancheResult] = await Promise.all([
      apiFetch<Party[]>(PARTIES_KEY, { method: "GET" }, withToken),
      apiFetch<PartyLootPool[]>(POOLS_KEY, { method: "GET" }, withToken),
      apiFetch<VestigeTranche[]>(TRANCHES_KEY, { method: "GET" }, withToken),
    ]);
    setParties(partyResult);
    setPools(poolResult);
    setTranches(trancheResult);
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

  /**
   * Records one tranche, or removes one.
   *
   * Both answer with the whole tally rather than the row touched, because the queue is re-spent
   * from all of it: a sale entered now can be what covers a boss cleared in July, and redrawing
   * from one row would be guessing at where its pieces landed.
   */
  async function saleWrite(path: string, options: RequestInit) {
    setBusy(true);
    try {
      setTranches(await apiFetch<VestigeTranche[]>(path, options, getToken));
    } catch (e) {
      // Thrown on, not shown here: the card that asked for it is a screen away from this page's
      // error line, and a refusal nobody is looking at is a refusal that did not happen.
      throw new Error(e instanceof ApiError ? e.body : "That didn't save.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Prices a pile of one interchangeable drop across every pool it sits in.
   *
   * Answers with the pools, so the rows redraw from what the server actually wrote rather than from
   * the proposal that was confirmed. All of them or none: see lotSaleRoute.
   */
  async function lotSale(body: LotSaleBody) {
    setBusy(true);
    try {
      setPools(
        await apiFetch<PartyLootPool[]>(
          "/api/parties/loot/lot",
          { method: "POST", body: JSON.stringify(body) },
          getToken,
        ),
      );
    } catch (e) {
      // Thrown on rather than shown here, as a tranche is: the card that asked is what the reader
      // is looking at, and this page's error line is a screen away from it.
      throw new Error(e instanceof ApiError ? e.body : "That didn't save.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Records who picked up which stacks of one drop.
   *
   * Answers with the pools rather than the row, for the same reason a tranche does: naming the
   * arrangement turns a drop nobody could be paid for into one that owes somebody, and every other
   * boss in that holder's queue is re-priced behind it.
   */
  async function bundlesWrite(partyId: string, lootId: string, bundles: Record<string, number>) {
    setBusy(true);
    try {
      await apiFetch<Loot>(
        `/api/parties/${partyId}/loot/${lootId}/bundles`,
        { method: "PUT", body: JSON.stringify({ bundles }) },
        getToken,
      );
      setPools(await apiFetch<PartyLootPool[]>(POOLS_KEY, {}, getToken));
    } catch (e) {
      throw new Error(e instanceof ApiError ? e.body : "That didn't save.");
    } finally {
      setBusy(false);
    }
  }

  const bossByKey = new Map(bosses.map((b) => [b.bossKey, b]));
  const characterById = new Map(characters.map((c) => [c.id, c]));
  // Roster order, as /api/characters returns it (Characters.position). The same list the party
  // arrangements are ordered by, so one character sits in the same place on both screens.
  const characterOrder = characters.map((c) => c.id);
  // The whole log is kept alongside the filtered one so the toolbar does not come and go: which
  // controls exist is a property of the account, not of what the filter currently leaves.
  const whole = buildDropLog(parties, pools, dropTables);
  const log = forCharacter(whole, character);
  const { totals } = log;
  const groups = groupDrops(log.entries, grouping);

  // Only characters that actually have drops. A filter offering a name with nothing behind it
  // reads as a bug the first time it is picked.
  const withDrops = characters.filter((c) =>
    parties.some((p) => p.characterId === c.id && pools.some((pool) => pool.partyId === p.id)),
  );

  // The ledger reads the WHOLE account, not the filtered log. A pile is one person's, spanning
  // every boss any of their characters loots for, so showing the part of it that falls in the
  // chosen month would price those bosses off a fraction of the sales that paid for them.
  const partyById = new Map(parties.map((p) => [p.id, p]));
  // The catalog's own order, which is what /api/bosses returns, so two bosses cleared in one week
  // never swap places in the queue and re-price each other.
  const bossOrder = new Map(bosses.map((b, i) => [b.bossKey, i]));
  const settled = outstanding(parties, pools, VESTIGE, bossOrder);
  const ledgers = holderLedgers(settled, salesByHolder(tranches));
  // Nights that did not divide and that nobody has said the arrangement for. Above the ledger,
  // because until one is answered its pieces are missing from every figure below it.
  const open = unanswered(parties, pools, VESTIGE);
  const behind = runningBalance(settled);
  const tranchesByHolder = new Map<string, VestigeTranche[]>();
  for (const tranche of tranches) {
    const key = holderKey(tranche.holder);
    tranchesByHolder.set(key, [...(tranchesByHolder.get(key) ?? []), tranche]);
  }
  // The piles of interchangeable drops waiting to be priced. Yours: a lot is filed against the seat
  // that sold it, and only your own seats are ones you can name as seller. A partner's pile stays on
  // its rows, where each names its own seller.
  const lots = lotDrops(parties, pools, fungibleDropKeys(dropTables), SELF_KEY);
  // The coupon's sprite, off whichever boss table carries it. Every table names the same drop.
  const vestigeIcon =
    Object.values(dropTables)
      .flat()
      .find((drop) => drop.dropKey === VESTIGE)?.iconUrl ?? null;

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
                {/* The pieces behind the count, because one row is one hammer or 180 coupons and a
                    number of rows does not say which. Only when somebody is holding some. */}
                {totals.piecesOwed > 0 && `, ${totals.piecesOwed} coupons owed you`}
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

          <StackArrangement
            drops={open}
            partyById={partyById}
            bossByKey={bossByKey}
            behind={behind}
            iconUrl={vestigeIcon}
            busy={busy}
            onSave={bundlesWrite}
          />

          <PieceLedger
            ledgers={ledgers}
            tranches={tranchesByHolder}
            bossByKey={bossByKey}
            partyById={partyById}
            iconUrl={vestigeIcon}
            busy={busy}
            onAddSale={(holder: Holder, pieces, amount) =>
              saleWrite(TRANCHES_KEY, {
                method: "POST",
                body: JSON.stringify({ holder, pieces, amount }),
              })
            }
            onRemoveSale={(trancheId) =>
              saleWrite(`${TRANCHES_KEY}/${trancheId}`, { method: "DELETE" })
            }
          />

          {/* Only where there is money to talk about. A Heroic-only account trades nothing, and
              lotDrops leaves those pools out anyway, so this is the same rule said once more. */}
          {money && (
            <LotSale
              drops={lots}
              bossByKey={bossByKey}
              partyById={partyById}
              busy={busy}
              onSell={lotSale}
            />
          )}

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
              characterOrder={characterOrder}
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
  characterOrder,
  showCharacter,
  money,
}: {
  group: DropGroup;
  bossByKey: Map<string, Boss>;
  characterById: Map<string, Character>;
  /** Character ids in roster order, which is what the runs behind a fold are sorted by. */
  characterOrder: string[];
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
        {consolidate(group.entries, characterOrder).map((line) => (
          <DropRow
            key={line.key}
            line={line}
            bossByKey={bossByKey}
            characterById={characterById}
            showCharacter={showCharacter}
          />
        ))}
      </ul>
    </section>
  );
}

function DropRow({
  line,
  bossByKey,
  characterById,
  showCharacter,
}: {
  line: DropLine;
  bossByKey: Map<string, Boss>;
  characterById: Map<string, Character>;
  showCharacter: boolean;
}) {
  const [open, setOpen] = useState(false);
  const entry = line.entries[0]!;
  const boss = bossByKey.get(entry.bossKey ?? "") ?? null;
  const characterName = characterById.get(entry.characterId)?.name ?? null;
  const panelId = `droplog-runs-${line.key}`;

  // A fold stands for several runs, so it names what they have in common instead of one boss and
  // one date. Both sides are counted rather than listed past a few: the runs themselves are under
  // the chevron, and eight boss names ran wider than the row.
  const meta = line.folded
    ? [
        foldNames(
          line.entries.map((e) => bossByKey.get(e.bossKey ?? "")?.name),
          "bosses",
        ),
        showCharacter
          ? foldNames(
              line.entries.map((e) => characterById.get(e.characterId)?.name),
              "characters",
            )
          : null,
      ].filter(Boolean)
    : [
        boss?.name,
        showCharacter ? characterName : null,
        formatDropped(entry.droppedOn),
        // The count on this row is your share, and this is who is holding it until they hand it
        // over. Without it the row reads as pieces you already have.
        entry.owedBy ? `${entry.owedBy} looted` : null,
        entry.sellerName
          ? `${entry.amountBasis === "BOUGHT" ? "bought by" : "sold by"} ${entry.sellerName}`
          : null,
      ].filter(Boolean);

  // One status for a fold only when every row agrees. Mixed is said as a count, because "in the
  // pool" over a line that is half sold would be the wrong half.
  // Off the row's own reading, not its raw status: a fold of coupon drops that are all already
  // yours agrees, and saying "in the pool" over it would be the same wrong word one level up.
  const statuses = [...new Set(line.entries.map(dropStatusLabel))];
  const status = statuses.length === 1 ? statuses[0]! : `${line.entries.length} rows`;
  const unreadable = line.entries.some((e) => e.unreadable);
  const runs = `${line.entries.length} runs`;
  // A heading per character is only worth the row when there is more than one to tell apart.
  const heads = showCharacter && new Set(line.entries.map((e) => e.characterId)).size > 1;

  return (
    <li className={`droplog-row status-${entry.status.toLowerCase()}${open ? " is-open" : ""}`}>
      <div className="droplog-row-head">
        {line.folded ? (
          <button
            type="button"
            className="party-row-toggle"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((o) => !o)}
          >
            <span className="party-row-chevron" aria-hidden="true" />
            <span className="visually-hidden">{open ? `Hide ${runs}` : `Show ${runs}`}</span>
          </button>
        ) : (
          // The frame is kept so one drop's row lines up with a folded one's.
          <span className="party-row-toggle is-empty" aria-hidden="true" />
        )}

        {line.iconUrl ? (
          <img className="loot-icon" src={apiAssetUrl(line.iconUrl)} alt="" />
        ) : (
          // No official art for this drop. An empty frame keeps the row aligned with the ones that
          // have it, as the loot pool does.
          <span className="loot-icon" aria-hidden="true" />
        )}

        <span className="droplog-title">
          {/* A fold's pieces came off several runs, so its name links to none of them: it opened
              whichever party happened to be first, which is one run out of eleven. The runs below
              carry the links. */}
          {line.folded ? (
            <span className="loot-name">
              {line.name}
              <span className="loot-count"> x{line.yours}</span>
            </span>
          ) : (
            <Link href={`/bosses/parties/${entry.partyId}`} className="loot-name">
              {line.name}
              {line.yours > 1 && <span className="loot-count"> x{line.yours}</span>}
            </Link>
          )}
          <span className="loot-meta">{meta.join(" · ")}</span>
        </span>

        <Amounts
          label={status}
          statusClass={entry.status.toLowerCase()}
          unreadable={unreadable}
          pooled={line.pooled}
          yourTake={line.yourTake}
        />
      </div>

      {line.folded && open && (
        <ul className="droplog-runs" id={panelId}>
          {line.entries.map((e, i) => (
            <Fragment key={e.lootId}>
              {/* The runs arrive grouped by character, so the name is a heading over each group
                  rather than a word repeated down the list. Only where it says something: under
                  the character filter, or a fold that is all one character, the line above has
                  already named them. */}
              {heads && e.characterId !== line.entries[i - 1]?.characterId && (
                <li className="droplog-run-head">
                  {characterById.get(e.characterId)?.name ?? "Unknown character"}
                </li>
              )}
              <RunRow
                entry={e}
                boss={bossByKey.get(e.bossKey ?? "") ?? null}
                characterName={characterById.get(e.characterId)?.name ?? null}
                showCharacter={showCharacter && !heads}
              />
            </Fragment>
          ))}
        </ul>
      )}
    </li>
  );
}

/** One row behind a fold: the run it came off, and the way into that party. */
function RunRow({
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
    formatDropped(entry.droppedOn),
    showCharacter ? characterName : null,
    entry.owedBy ? `${entry.owedBy} looted` : null,
    entry.sellerName
      ? `${entry.amountBasis === "BOUGHT" ? "bought by" : "sold by"} ${entry.sellerName}`
      : null,
  ].filter(Boolean);

  return (
    <li className="droplog-run">
      {/* No portrait: the drop's own icon is on the line above, and a second column of art told
          nobody which run this was that the boss name did not already say. */}
      <Link href={`/bosses/parties/${entry.partyId}`} className="loot-name">
        {/* The drop is named by the line above, so the run is named by its boss. Free text can be
            filed with no boss at all, and then the date is all there is to click. */}
        {boss?.name ?? formatDropped(entry.droppedOn)}
        {/* Yours, the same as the line above sums. Counting what fell here made a fold of 440
            open onto runs adding up to 900. */}
        {entry.yours > 1 && <span className="loot-count"> x{entry.yours}</span>}
      </Link>
      <span className="loot-meta">{meta.join(" · ")}</span>
      <Amounts
        label={dropStatusLabel(entry)}
        statusClass={entry.status.toLowerCase()}
        unreadable={entry.unreadable}
        pooled={entry.pooled}
        yourTake={entry.yourTake}
      />
    </li>
  );
}

/** The right of a line or a run: what it made, or where it is instead. */
function Amounts({
  label,
  statusClass,
  unreadable,
  pooled,
  yourTake,
}: {
  label: string;
  statusClass: string;
  unreadable: boolean;
  pooled: number | null;
  yourTake: number | null;
}) {
  if (unreadable) {
    return (
      <span className="droplog-amounts">
        <span className="loot-share-nets">split unreadable</span>
      </span>
    );
  }
  if (pooled === null) {
    return (
      <span className="droplog-amounts">
        <span className={`loot-status is-${statusClass}`}>{label}</span>
      </span>
    );
  }
  return (
    <span className="droplog-amounts">
      <span className="droplog-take">{formatMesos(yourTake ?? 0, true)}</span>
      <span className="loot-share-nets">of {formatMesos(pooled, true)}</span>
    </span>
  );
}
