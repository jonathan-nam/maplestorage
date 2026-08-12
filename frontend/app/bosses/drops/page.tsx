"use client";

import { PAGE_WAITING } from "@/components/route-loading";
import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useEffect, useState } from "react";
import { CollectionLedger } from "@/components/collection-ledger";
import { LogDrop } from "@/components/log-drop";
import { LotSale } from "@/components/lot-sale";
import { PieceLedger } from "@/components/piece-ledger";
import { StackArrangement } from "@/components/stack-arrangement";
import { TrancheHistory } from "@/components/tranche-history";
import { ApiError, apiAssetUrl, apiFetch } from "@/lib/api";
import { peek, put } from "@/lib/cache";
import { buildCollection, stillOnSaleLedger } from "@/lib/collection";
import { worthDrawing } from "@/lib/ledger-fates";
import { buildWallet } from "@/lib/wallet";
import { type DropSectionKey, dropSections, saleCards, shownSection } from "@/lib/drop-sections";
import {
  buildDropLog,
  byCharacter,
  forCharacter,
  groupDrops,
  type CharacterFold,
  type DropLine,
  consolidate,
  dropStatusLabel,
  foldNames,
  foldStatus,
  oneBossBehind,
  type DropEntry,
  type DropGroup,
  type Grouping,
} from "@/lib/drop-log";
import { formatMesos } from "@/lib/drop-split";
import { formatDropped } from "@/lib/loot";
import { type LotSaleBody, fungibleDropKeys, lotDrops } from "@/lib/lot-sale";
import { useDropIcons } from "@/lib/drop-icons";
import { useSeatSprites } from "@/lib/seat-sprites";
import { useAccountSettings } from "@/lib/use-account-settings";
import {
  type Holder,
  SELF_KEY,
  alsoHeldByYou,
  boughtByHolder,
  foldSeats,
  holderKey,
  holderLedgers,
  closedByHolder,
  keptByHolder,
  outstanding,
  receivedByHolder,
  receivedSinceClosing,
  saleCredits,
  stillOpen,
  runningBalance,
  salesByHolder,
  unanswered,
} from "@/lib/vestige-ledger";
import { showsMoney } from "@/lib/world";
import type { Boss } from "@/types/boss";
import type { Character } from "@/types/character";
import type { DropTables } from "@/types/drop";
import type { Loot, LogDropBody, PartyLootPool, SettleBody } from "@/types/loot";
import type { Party } from "@/types/party";
import type {
  CollectionDebt,
  VestigePayment,
  VestigeSettlement,
  VestigeTranche,
  VestigeTrancheShare,
} from "@/types/vestige";

// The history of what dropped, and what it made, and where a drop is logged. Every meso is
// lib/drop-log.ts's, which is splitOf()'s, which is splitDrop()'s. Nothing here adds anything up.

type LoadState = "loading" | "loaded" | "error";

// Solo pools included, and retired configs too, which only the wallet also asks for: both hold
// drops whose configs are off every list, and buildDropLog skips a pool whose config it cannot
// find, so without these the log would quietly be missing them. See partiesFor.
const PARTIES_KEY = "/api/parties?solo=include&retired=include";
const POOLS_KEY = "/api/parties/loot";
// The Wallet's settle, reused rather than reimplemented: one act, one endpoint, one set of rows.
const SETTLE_KEY = "/api/parties/loot/settle";
const BOSSES_KEY = "/api/bosses";
const DROPS_KEY = "/api/bosses/drops";
const CHARACTERS_KEY = "/api/characters";
const TRANCHES_KEY = "/api/vestige-tranches";
const PAYMENTS_KEY = "/api/vestige-payments";
const SETTLEMENTS_KEY = "/api/vestige-settlements";
const DEBTS_KEY = "/api/collection-debts";

// The stacking drop the piece ledger is for. One key, because one item behaves this way: a boss
// drops it in bundles that do not divide by looting alone. See lib/piece-ledger.ts.
const VESTIGE = "vestige-of-erion";

export default function DropLogPage() {
  const { getToken } = useAuth();
  // This page sums across every party the server hands back, which is one world's. In a Heroic
  // world the money tiles would be three true zeroes, so they go.
  const money = showsMoney(useAccountSettings()?.trades);

  const [parties, setParties] = useState<Party[]>(peek<Party[]>(PARTIES_KEY) ?? []);
  const [pools, setPools] = useState<PartyLootPool[]>([]);
  const [bosses, setBosses] = useState<Boss[]>(peek<Boss[]>(BOSSES_KEY) ?? []);
  const [dropTables, setDropTables] = useState<DropTables>(peek<DropTables>(DROPS_KEY) ?? {});
  const [characters, setCharacters] = useState<Character[]>(
    peek<Character[]>(CHARACTERS_KEY) ?? [],
  );
  const [tranches, setTranches] = useState<VestigeTranche[]>([]);
  const [payments, setPayments] = useState<VestigePayment[]>([]);
  const [settlements, setSettlements] = useState<VestigeSettlement[]>([]);
  const [debts, setDebts] = useState<CollectionDebt[]>([]);

  // A drop names the party it fell in and links to it, which draws its seats. See
  // lib/seat-sprites.ts.
  useSeatSprites(parties);
  // The Add Drop form's own picker draws them. See lib/drop-icons.ts.
  useDropIcons(dropTables);
  const [state, setState] = useState<LoadState>("loading");
  const [character, setCharacter] = useState<string | null>(null);
  const [grouping, setGrouping] = useState<Grouping>("month");
  // Whether the reader has asked for the box that sells out of a pile nobody is owed anything from.
  const [sellingOwn, setSellingOwn] = useState(false);
  const [section, setSection] = useState<DropSectionKey>("drops");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(token?: string | null) {
    const withToken = token !== undefined ? () => Promise.resolve(token) : getToken;
    const [partyResult, poolResult, trancheResult, paymentResult, settlementResult, debtResult] =
      await Promise.all([
        apiFetch<Party[]>(PARTIES_KEY, { method: "GET" }, withToken),
        apiFetch<PartyLootPool[]>(POOLS_KEY, { method: "GET" }, withToken),
        apiFetch<VestigeTranche[]>(TRANCHES_KEY, { method: "GET" }, withToken),
        apiFetch<VestigePayment[]>(PAYMENTS_KEY, { method: "GET" }, withToken),
        apiFetch<VestigeSettlement[]>(SETTLEMENTS_KEY, { method: "GET" }, withToken),
        apiFetch<CollectionDebt[]>(DEBTS_KEY, { method: "GET" }, withToken),
      ]);
    setParties(partyResult);
    setPools(poolResult);
    setTranches(trancheResult);
    setPayments(paymentResult);
    setSettlements(settlementResult);
    setDebts(debtResult);
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

  /** The same, for closing a pile's books. See V52. */
  async function settlementWrite(path: string, options: RequestInit) {
    setBusy(true);
    try {
      setSettlements(await apiFetch<VestigeSettlement[]>(path, options, getToken));
    } catch (e) {
      throw new Error(e instanceof ApiError ? e.body : "That didn't save.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Marks a person's unpaid SHARES paid, which is the other half of a collection.
   *
   * The Wallet's own act, against the same payout rows, rather than a second way to mark a share
   * paid: two of those would disagree the first time one of them was changed. Answers with the
   * pools, so the rows redraw from what the server wrote.
   */
  async function settleShares(payouts: { lootId: string; memberId: string }[]) {
    if (payouts.length === 0) return;
    setBusy(true);
    try {
      const body: SettleBody = { payouts };
      setPools(
        await apiFetch<PartyLootPool[]>(
          SETTLE_KEY,
          { method: "POST", body: JSON.stringify(body) },
          getToken,
        ),
      );
    } catch (e) {
      throw new Error(e instanceof ApiError ? e.body : "That didn't save.");
    } finally {
      setBusy(false);
    }
  }

  /** The same, for an entered debt. Its own state, because it touches no drop at all. See V56. */
  async function debtWrite(path: string, options: RequestInit) {
    setBusy(true);
    try {
      setDebts(await apiFetch<CollectionDebt[]>(path, options, getToken));
    } catch (e) {
      throw new Error(e instanceof ApiError ? e.body : "That didn't save.");
    } finally {
      setBusy(false);
    }
  }

  /** The same, for a receipt. Its own state, because a payment changes no piece. See V51. */
  async function paymentWrite(path: string, options: RequestInit) {
    setBusy(true);
    try {
      setPayments(await apiFetch<VestigePayment[]>(path, options, getToken));
    } catch (e) {
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
  const closures = closedByHolder(settlements);
  const whole = buildDropLog(parties, pools, dropTables, closures.closed);
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
  // Your own coupons from the nights that owed nobody anything, which the queue above leaves out.
  // They are yours to sell, so the card that takes a sale has to know you are holding them.
  const ledgers = holderLedgers(
    [...settled, ...alsoHeldByYou(parties, pools, VESTIGE, bossOrder, settled)],
    salesByHolder(tranches),
    keptByHolder(tranches),
    boughtByHolder(tranches),
    receivedByHolder(payments),
    closures,
  );
  // What other people owe you, in both units it can be owed in: pieces of yours they are holding,
  // and shares of a sale they made. Off the same two aggregations the ledger and the wallet already
  // run, so there is no third answer to keep in step.
  // Somebody a debt can name but no open drop does. Off the seats of every party, folded to their
  // people, which is the same fold every figure on this page is measured against.
  const holderNames = new Map<string, string>();
  for (const party of parties) {
    for (const seat of foldSeats(party.seats)) holderNames.set(seat.key, seat.name);
  }
  const wallet = buildWallet(parties, pools);
  const collection = buildCollection(
    ledgers,
    wallet,
    debts,
    saleCredits(tranches),
    // Only what no closure has already spoken for. A payment that settled a pile is spent, and
    // counting it again takes it off the next thing entered against that person. See #350.
    receivedSinceClosing(payments, settlements),
    holderNames,
  );
  // Nights that did not divide and that nobody has said the arrangement for. Above the ledger,
  // because until one is answered its pieces are missing from every figure below it.
  const open = unanswered(parties, pools, VESTIGE);
  // Only the drops still open tilt the rotation: a debt that has been closed was compensated, so it
  // has no business suggesting against the same person forever. See V52.
  const behind = runningBalance(stillOpen(settled, closures.closed));
  const tranchesByHolder = new Map<string, VestigeTranche[]>();
  for (const tranche of tranches) {
    const key = holderKey(tranche.holder);
    tranchesByHolder.set(key, [...(tranchesByHolder.get(key) ?? []), tranche]);
  }
  const paymentsByHolder = new Map<string, VestigePayment[]>();
  for (const paid of payments) {
    const key = holderKey(paid.holder);
    paymentsByHolder.set(key, [...(paymentsByHolder.get(key) ?? []), paid]);
  }
  // The Sale Ledger is piles you can sell out of, which is yours. Somebody else's stays only while
  // it has rows recorded under the old shape, as history: those are correctable nowhere else. What
  // they OWE is the Collection Ledger's to say, and only its, so the two never give two answers.
  const recorded = (key: string) =>
    (tranchesByHolder.get(key)?.length ?? 0) > 0 || (paymentsByHolder.get(key)?.length ?? 0) > 0;
  const { yours, history } = stillOnSaleLedger(ledgers, recorded);
  // Of your own piles, the ones with something to answer. A pile that owes nobody is somewhere a sale
  // may be recorded and nothing else, so it waits behind the control that offers exactly that rather
  // than standing on screen saying "holding 1140" at somebody with nothing to do about it.
  const { drawn, quiet } = worthDrawing(yours, recorded);
  const shownYours = sellingOwn ? [...drawn, ...quiet] : drawn;
  const historyHolders = history.map((l) => ({
    key: holderKey(l.holder),
    holder: l.holder,
    name: l.holderName,
  }));
  // The piles of interchangeable drops waiting to be priced. Yours: a lot is filed against the seat
  // that sold it, and only your own seats are ones you can name as seller. A partner's pile stays on
  // its rows, where each names its own seller.
  const lots = lotDrops(parties, pools, fungibleDropKeys(dropTables), SELF_KEY);
  // Whether the lot boxes will draw anything, which decides with the coupon piles whether there is a
  // Record Sale section at all. A heading over no cards is a heading over nothing.
  const sellableLots = money && lots.length > 0;
  // The coupon's sprite, off whichever boss table carries it. Every table names the same drop.
  const vestigeIcon =
    Object.values(dropTables)
      .flat()
      .find((drop) => drop.dropKey === VESTIGE)?.iconUrl ?? null;

  // What fell, and what it was sold for, one at a time. Both halves are entered into rather than
  // read, so they stay on one page: a drop and the sale that prices it are the same evening's work.
  // See lib/drop-sections.ts for why the chosen tab is not drawn straight from state.
  const sections = dropSections();
  const shown = shownSection(section, sections);
  // Whether either ledger has anything on it, which is what decides between its cards and one line
  // saying there are none. All three tabs are always offered. See lib/drop-sections.ts.
  const hasSales =
    saleCards({
      unanswered: open.length,
      holders: shownYours.length + history.length,
      lots: money ? lots.length : 0,
    }) > 0;

  return (
    <main className={state === "loading" ? PAGE_WAITING : "page"}>
      <h1 className="page-title">Drop Log</h1>

      {state === "error" && <p>Couldn&apos;t load your drops.</p>}
      {state === "loading" && <p className="party-hint">Loading...</p>}

      {state === "loaded" && (
        <>
          {sections.length > 1 && (
            <div className="basis-row droplog-sections" role="group" aria-label="Section">
              {sections.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  className={shown === s.key ? "basis-tab active" : "basis-tab"}
                  aria-pressed={shown === s.key}
                  onClick={() => setSection(s.key)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}

          {shown === "drops" && (
            <>
              {/* Above the totals it changes. Nothing to log against with no roster, and a picker of
                  nobody is not worth holding the space for. */}
              {characters.length > 0 && (
                <LogDrop
                  characters={characters}
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
                    {/* Whichever happened. A Heroic account never sells one and an Interactive
                        one never takes one, so in practice this is a single figure either way. */}
                    {[
                      totals.sold > 0 || totals.taken === 0 ? `${totals.sold} sold` : null,
                      totals.taken > 0 ? `${totals.taken} taken` : null,
                    ]
                      .filter(Boolean)
                      .join(", ")}
                    {totals.pending > 0 && `, ${totals.pending} in the pool`}
                    {/* The pieces behind the count, because one row is one hammer or 180
                        coupons and a number of rows does not say which. Only when somebody is
                        holding some. */}
                    {totals.piecesOwed > 0 && `, ${totals.piecesOwed} coupons owed you`}
                  </span>
                </div>
                {money && (
                  <>
                    <div className="stat-tile">
                      <span className="stat-label">Sold for</span>
                      <span className="stat-value is-good">{formatMesos(totals.pooled, true)}</span>
                      {/* Labelled precisely, because the obvious reading of "total sales" is a
                          number that cannot be computed. See the header of lib/drop-log.ts. */}
                      <span className="stat-note">what there was to split</span>
                    </div>
                    <div className="stat-tile">
                      <span className="stat-label">Your take</span>
                      <span className="stat-value is-good">
                        {formatMesos(totals.yourTake, true)}
                      </span>
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
                  characterOrder={characterOrder}
                  showCharacter={character === null}
                  money={money}
                />
              ))}

              {totals.unreadable > 0 && (
                <p className="loot-warn droplog-note">
                  {totals.unreadable} sold {totals.unreadable === 1 ? "drop names" : "drops name"} a
                  seat that has left its party, so {totals.unreadable === 1 ? "its" : "their"} split
                  cannot be read. {totals.unreadable === 1 ? "It is" : "They are"} listed below with
                  no figures, and {totals.unreadable === 1 ? "its" : "their"} money is in neither
                  total above.
                </p>
              )}
            </>
          )}

          {shown === "sales" && (
            <>
              {!hasSales && <p className="party-hint">No sales to record.</p>}
              {/* One heading over every card that takes a sale, which is the lot boxes AND the coupon
                  piles: both are "sold N for X". Titling only one of them said the other was a
                  statement rather than an entry. No rule under it either, because what follows is
                  more of the same thing and there is nothing there to divide. */}
              {/* Gated on what will actually draw, not on there being ledgers at all: a pile held
                  back for owing nobody leaves the heading standing over nothing. */}
              {(sellableLots || shownYours.length > 0 || history.length > 0) && (
                <section className="loot-pool">
                  <h2 className="loot-pool-title">Record Sale</h2>

                  {/* Only where there is money to talk about. A Heroic-only account trades nothing,
                      and lotDrops leaves those pools out anyway. */}
                  {money && (
                    <LotSale
                      drops={lots}
                      bossByKey={bossByKey}
                      partyById={partyById}
                      busy={busy}
                      onSell={lotSale}
                    />
                  )}

                  <PieceLedger
                    ledgers={shownYours}
                    tranches={tranchesByHolder}
                    bossByKey={bossByKey}
                    partyById={partyById}
                    iconUrl={vestigeIcon}
                    busy={busy}
                    // `shares` says how many of the pieces were somebody else's, so their part of
                    // what this lot fetched lands on the Collection Ledger. Empty is the whole sale
                    // being your own, which is every tranche entered before V56. See saleCredits.
                    onAddSale={(holder: Holder, pieces, amount, shares: VestigeTrancheShare[]) =>
                      saleWrite(TRANCHES_KEY, {
                        method: "POST",
                        body: JSON.stringify({
                          holder,
                          pieces,
                          amount,
                          disposition: "SOLD",
                          shares,
                        }),
                      })
                    }
                    // No amount: a redemption realized nothing, where a sale for zero would price those
                    // pieces at nothing. The server refuses the two disagreeing. See V46.
                    onAddKept={(holder: Holder, pieces) =>
                      saleWrite(TRANCHES_KEY, {
                        method: "POST",
                        body: JSON.stringify({ holder, pieces, disposition: "KEPT" }),
                      })
                    }
                    // Pieces of yours they took instead of selling, at a price somebody agreed. An
                    // amount like a sale, and off the pile like a redemption. See V50.
                    onAddBought={(holder: Holder, pieces, amount) =>
                      saleWrite(TRANCHES_KEY, {
                        method: "POST",
                        body: JSON.stringify({ holder, pieces, amount, disposition: "BOUGHT" }),
                      })
                    }
                    onRemoveSale={(trancheId) =>
                      saleWrite(`${TRANCHES_KEY}/${trancheId}`, { method: "DELETE" })
                    }
                  />

                  {/* Somebody else's rows, from when their sales were entered here. No debt and no
                      total: what they owe is the Collection Ledger's to say. Here so a mistyped one
                      can still be taken back, and gone once there are none left. */}
                  <TrancheHistory
                    holders={historyHolders}
                    tranches={tranchesByHolder}
                    payments={paymentsByHolder}
                    busy={busy}
                    onRemoveSale={(trancheId) =>
                      saleWrite(`${TRANCHES_KEY}/${trancheId}`, { method: "DELETE" })
                    }
                    onRemovePayment={(paymentId) =>
                      paymentWrite(`${PAYMENTS_KEY}/${paymentId}`, { method: "DELETE" })
                    }
                  />
                </section>
              )}

              {/* The way back to a pile that owes nobody. Holding coupons is not a task, so it is not
                  a card until it is asked for, but they are still yours to sell and a ledger that
                  will not admit you hold them cannot take the sale. After the cards rather than
                  above them: it is the way to one more of the same, not a heading over them. */}
              {quiet.length > 0 && !sellingOwn && (
                <button type="button" className="party-save" onClick={() => setSellingOwn(true)}>
                  Record a sale
                </button>
              )}

              {/* Last, and the one real boundary on this tab: every card above takes a sale, and this
                  one cannot be acted on for money at all. It names the nights whose arrangement
                  nobody has said, and nothing about them can be priced until somebody does. Still on
                  screen, because a drop that owes somebody and cannot say who is exactly what must
                  not be quietly dropped. */}
              <StackArrangement
                drops={open}
                partyById={partyById}
                bossByKey={bossByKey}
                behind={behind}
                iconUrl={vestigeIcon}
                busy={busy}
                onSave={bundlesWrite}
              />
            </>
          )}

          {shown === "collection" && (
            <section className="loot-pool">
              <h2 className="loot-pool-title">Collection Ledger</h2>
              {collection.length === 0 && <p className="party-hint">No collections to record.</p>}
              <CollectionLedger
                rows={collection}
                bossByKey={bossByKey}
                partyById={partyById}
                busy={busy}
                onAddPayment={(holder: Holder, amount) =>
                  paymentWrite(PAYMENTS_KEY, {
                    method: "POST",
                    body: JSON.stringify({ holder, amount }),
                  })
                }
                onAddDebt={(holder: Holder, amount, note) =>
                  debtWrite(DEBTS_KEY, {
                    method: "POST",
                    body: JSON.stringify({ holder, amount, note: note || undefined }),
                  })
                }
                onRemoveDebt={(debtId) => debtWrite(`${DEBTS_KEY}/${debtId}`, { method: "DELETE" })}
                onSettlePieces={(holder: Holder, lootIds) =>
                  settlementWrite(SETTLEMENTS_KEY, {
                    method: "POST",
                    // Nothing written off: a piece debt was never priced, so there is no shortfall
                    // to record. What they sent is on the receipts.
                    body: JSON.stringify({ holder, lootIds, unpaid: 0 }),
                  })
                }
                onSettleShares={settleShares}
              />

              {/* What the cards above do NOT cover, from the Wallet this tab replaced. A total that
                  is short must not read as a total that is complete. */}
              {(wallet.unreadable > 0 || wallet.betweenOthers > 0 || wallet.betweenMine > 0) && (
                <ul className="ledger-notes">
                  {wallet.unreadable > 0 && (
                    <li className="loot-warn">
                      {wallet.unreadable} sold{" "}
                      {wallet.unreadable === 1 ? "drop names a seat" : "drops name a seat"} that has
                      left its party, so {wallet.unreadable === 1 ? "its" : "their"} split cannot be
                      read. Not counted above.
                    </li>
                  )}
                  {wallet.betweenOthers > 0 && (
                    <li>
                      {wallet.betweenOthers} unpaid{" "}
                      {wallet.betweenOthers === 1 ? "share is" : "shares are"} between two other
                      people, not yours to settle.
                    </li>
                  )}
                  {wallet.betweenMine > 0 && (
                    <li>
                      {wallet.betweenMine} unpaid{" "}
                      {wallet.betweenMine === 1 ? "share is" : "shares are"} between two of your own
                      characters, so there is nobody to settle with.
                    </li>
                  )}
                </ul>
              )}
            </section>
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

  const status = foldStatus(line.entries);
  const unreadable = line.entries.some((e) => e.unreadable);
  const runs = `${line.entries.length} runs`;
  // A level per character is only worth the chevron when there is more than one to tell apart.
  const heads = showCharacter && new Set(line.entries.map((e) => e.characterId)).size > 1;
  // The fold's own meta names the one boss they all came off, so the runs under it are told apart
  // by date instead of by the same name once per run.
  const oneBoss = oneBossBehind(line.entries);

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
          {/* Whose they are first, and only then which nights. A week of five bosses on six
              characters is thirty rows, and what is asked of a coupon fold is how many each
              character got. Skipped where there is one character to tell apart: the line above has
              already named them, and a chevron onto a single group opens onto itself. */}
          {heads
            ? byCharacter(line.entries).map((fold) => (
                <CharacterRuns
                  key={fold.characterId}
                  fold={fold}
                  name={characterById.get(fold.characterId)?.name ?? "Unknown character"}
                  panelId={`${panelId}-${fold.characterId}`}
                  bossByKey={bossByKey}
                  oneBoss={oneBoss}
                />
              ))
            : line.entries.map((e) => (
                <RunRow
                  key={e.lootId}
                  entry={e}
                  boss={oneBoss ? null : (bossByKey.get(e.bossKey ?? "") ?? null)}
                  characterName={characterById.get(e.characterId)?.name ?? null}
                  showCharacter={showCharacter}
                />
              ))}
        </ul>
      )}
    </li>
  );
}

/** One character's share of a fold, opening onto the nights it came off. */
function CharacterRuns({
  fold,
  name,
  panelId,
  bossByKey,
  oneBoss,
}: {
  fold: CharacterFold;
  name: string;
  panelId: string;
  bossByKey: Map<string, Boss>;
  /** Every run behind the whole fold came off one boss, so its runs are told apart by date. */
  oneBoss: boolean;
}) {
  const [open, setOpen] = useState(false);
  const runs = `${fold.entries.length} runs`;

  return (
    <li className={`droplog-character${open ? " is-open" : ""}`}>
      <div className="droplog-character-head">
        <button
          type="button"
          className="party-row-toggle"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((o) => !o)}
        >
          <span className="party-row-chevron" aria-hidden="true" />
          <span className="visually-hidden">
            {open ? `Hide ${name}'s ${runs}` : `Show ${name}'s ${runs}`}
          </span>
        </button>

        {/* The name links nowhere: these runs are several parties, and picking one of them to be
            the destination is picking whichever happened to be first. The runs carry the links. */}
        <span className="loot-name">
          {name}
          <span className="loot-count"> x{fold.yours}</span>
        </span>

        <Amounts
          label={foldStatus(fold.entries)}
          statusClass={fold.entries[0]!.status.toLowerCase()}
          unreadable={fold.entries.some((e) => e.unreadable)}
          pooled={fold.pooled}
          yourTake={fold.yourTake}
        />
      </div>

      {open && (
        <ul className="droplog-runs is-nested" id={panelId}>
          {fold.entries.map((e) => (
            <RunRow
              key={e.lootId}
              entry={e}
              boss={oneBoss ? null : (bossByKey.get(e.bossKey ?? "") ?? null)}
              characterName={name}
              // Named by the row above, so a run under it would be saying it a second time.
              showCharacter={false}
            />
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
    // Not said twice: where there is no boss to name, the date IS the label above.
    boss ? formatDropped(entry.droppedOn) : null,
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
        {/* The drop is named by the line above, so the run is named by its boss. Null where the
            line above already named the one boss they all came off, and where free text was filed
            with no boss at all: the date is what is left to tell the runs apart. */}
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
