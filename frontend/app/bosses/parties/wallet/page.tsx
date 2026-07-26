"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useEffect, useState } from "react";
import { CopyAmount } from "@/components/copy-amount";
import { apiAssetUrl, apiFetch } from "@/lib/api";
import { peek, put } from "@/lib/cache";
import { formatMesos } from "@/lib/drop-split";
import { formatDropped } from "@/lib/loot";
import { buildWallet, netLabel, type Counterparty } from "@/lib/wallet";
import { preloadBossArt } from "@/lib/preload-boss-art";
import type { Boss } from "@/types/boss";
import type { PartyLootPool } from "@/types/loot";
import type { Party } from "@/types/party";

// Every unpaid share across every pool, folded to one line per person.
//
// The arithmetic is all lib/wallet.ts, which is all lib/loot.ts, which is all drop-split.ts. This
// file draws it. A figure computed here would be a second answer to "what do I send you".

type LoadState = "loading" | "loaded" | "error";

const PARTIES_KEY = "/api/parties";
const POOLS_KEY = "/api/parties/loot";
const BOSSES_KEY = "/api/bosses";

export default function WalletPage() {
  // Before anything is fetched: see lib/preload-boss-art.ts.
  preloadBossArt();

  const { getToken } = useAuth();

  const seededParties = peek<Party[]>(PARTIES_KEY);
  const seededBosses = peek<Boss[]>(BOSSES_KEY);

  const [parties, setParties] = useState<Party[]>(seededParties ?? []);
  const [pools, setPools] = useState<PartyLootPool[]>([]);
  const [bosses, setBosses] = useState<Boss[]>(seededBosses ?? []);
  const [state, setState] = useState<LoadState>("loading");
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    // One token for the whole burst: getToken() can round-trip to Clerk.
    getToken()
      .then((token) => {
        const withToken = () => Promise.resolve(token);
        return Promise.all([
          apiFetch<Party[]>(PARTIES_KEY, { method: "GET" }, withToken),
          apiFetch<PartyLootPool[]>(POOLS_KEY, { method: "GET" }, withToken),
          apiFetch<Boss[]>(BOSSES_KEY, { method: "GET" }, withToken),
        ]);
      })
      .then(([partyResult, poolResult, bossResult]) => {
        setParties(partyResult);
        setPools(poolResult);
        setBosses(bossResult);
        put(PARTIES_KEY, partyResult);
        put(BOSSES_KEY, bossResult);
        setState("loaded");
      })
      // The pools are never cached, so there is nothing to fall back to: a wallet drawn from a
      // stale pool is a debt that may already be settled.
      .catch(() => setState("error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const bossByKey = new Map(bosses.map((b) => [b.bossKey, b]));
  const wallet = buildWallet(parties, pools);
  const settled = state === "loaded" && wallet.counterparties.length === 0;

  return (
    <main className="page">
      <p className="loot-back">
        <Link href="/bosses/parties">&larr; Parties</Link>
      </p>

      <h1 className="page-title">Wallet</h1>
      <p className="split-intro">
        What you owe and what you&apos;re owed, across every party&apos;s loot pool. Mark a share
        paid on its party to clear it from here.
      </p>

      {state === "error" && <p>Couldn&apos;t load your pools.</p>}
      {state === "loading" && <p className="party-hint">Loading...</p>}

      {state === "loaded" && (
        <>
          <div className="wallet-totals">
            <div className="wallet-total is-owe">
              <span className="wallet-total-label">You owe</span>
              <span className="wallet-total-value">{formatMesos(wallet.owe, true)}</span>
            </div>
            <div className="wallet-total is-owed">
              <span className="wallet-total-label">You&apos;re owed</span>
              <span className="wallet-total-value">{formatMesos(wallet.owed, true)}</span>
            </div>
            <div className={`wallet-total is-net ${wallet.net < 0 ? "is-down" : "is-up"}`}>
              <span className="wallet-total-label">Net</span>
              <span className="wallet-total-value">
                {wallet.net < 0 ? "-" : ""}
                {formatMesos(Math.abs(wallet.net), true)}
              </span>
            </div>
          </div>

          {settled && wallet.unreadable === 0 && (
            <p className="finder-empty">
              Nothing outstanding. Every sold drop in every pool has been paid out.
            </p>
          )}

          {wallet.counterparties.map((person) => (
            <WalletRow
              key={person.key}
              person={person}
              bossByKey={bossByKey}
              open={open === person.key}
              onToggle={() => setOpen((current) => (current === person.key ? null : person.key))}
            />
          ))}

          {/* What the totals above do NOT cover. Said out loud rather than left out, so a total
              that is short is not read as a total that is complete. */}
          {(wallet.unreadable > 0 || wallet.betweenOthers > 0 || wallet.betweenMine > 0) && (
            <ul className="wallet-notes">
              {wallet.unreadable > 0 && (
                <li className="loot-warn">
                  {wallet.unreadable} sold {wallet.unreadable === 1 ? "drop names" : "drops name"} a
                  seat that is no longer in its party, so{" "}
                  {wallet.unreadable === 1 ? "its" : "their"} split cannot be read. Those are NOT in
                  the totals above.
                </li>
              )}
              {wallet.betweenOthers > 0 && (
                <li>
                  {wallet.betweenOthers} unpaid{" "}
                  {wallet.betweenOthers === 1 ? "share is" : "shares are"} between two other people
                  in your parties. Not yours to settle.
                </li>
              )}
              {wallet.betweenMine > 0 && (
                <li>
                  {wallet.betweenMine} unpaid {wallet.betweenMine === 1 ? "share is" : "shares are"}{" "}
                  between two of your own characters. Mesos to move, but nobody to settle with.
                </li>
              )}
            </ul>
          )}
        </>
      )}
    </main>
  );
}

/** One person, what they net out to, and the drops behind it. */
function WalletRow({
  person,
  bossByKey,
  open,
  onToggle,
}: {
  person: Counterparty;
  bossByKey: Map<string, Boss>;
  open: boolean;
  onToggle: () => void;
}) {
  const both = person.owe > 0 && person.owed > 0;

  return (
    <article className={`wallet-row ${person.net < 0 ? "is-owe" : "is-owed"}`}>
      <header className="wallet-row-head">
        <h2 className="wallet-name">
          {person.name}
          {/* An unattributed seat is a CHARACTER, and the same human may be under a second name
              further down this list. Say so rather than let the row read as a person. */}
          {!person.attributed && (
            <span className="wallet-unattributed" title="No person owns this character yet">
              character
            </span>
          )}
        </h2>
        <span className="wallet-verdict">{netLabel(person.net)}</span>
        <CopyAmount
          value={Math.abs(person.net)}
          display={formatMesos(Math.abs(person.net), true)}
        />
        <button type="button" className="party-cancel" onClick={onToggle} aria-expanded={open}>
          {open ? "Hide" : `${person.lines.length} ${person.lines.length === 1 ? "drop" : "drops"}`}
        </button>
      </header>

      {/* Both directions outstanding: the net above is one transfer instead of two, which is a
          hop's Auction House fee saved. The gross pair stays on screen so it is a choice. */}
      {both && (
        <p className="wallet-gross">
          You owe {formatMesos(person.owe, true)}, they owe {formatMesos(person.owed, true)}.
        </p>
      )}

      {open && (
        <ul className="wallet-lines">
          {person.lines.map((line) => (
            <li key={`${line.lootId}-${line.theirsId}`} className={`is-${line.direction}`}>
              <span className="wallet-line-drop">
                {bossByKey.get(line.bossKey ?? "")?.iconUrl && (
                  <img
                    className="boss-portrait is-small"
                    src={apiAssetUrl(bossByKey.get(line.bossKey!)!.iconUrl!)}
                    alt=""
                  />
                )}
                <Link href={`/bosses/parties/${line.partyId}`}>{line.name}</Link>
              </span>
              <span className="wallet-line-who">
                {line.direction === "owe"
                  ? `${line.mine} sold, owes ${line.theirs}`
                  : `${line.theirs} sold, owes ${line.mine}`}
                {" · "}
                {formatDropped(line.droppedOn)}
              </span>
              <CopyAmount value={line.pay} display={formatMesos(line.pay, true)} />
              <span className="loot-share-nets">nets {formatMesos(line.nets, true)}</span>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
