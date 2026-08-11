"use client";

import Link from "next/link";
import { useState } from "react";
import { formatWeekStart } from "@/lib/boss-clears";
import { bossLabel } from "@/lib/boss-difficulty";
import { type Collection, sharesOf } from "@/lib/collection";
import { formatMesos, parseMesos, shortMesos } from "@/lib/drop-split";
import type { Holder } from "@/lib/vestige-ledger";
import type { Boss } from "@/types/boss";
import type { Party } from "@/types/party";

// One card per person who owes you something, in the two units a debt can be in.
//
// The two halves are not symmetric and the card does not pretend they are. A SHARE is a figure: they
// sold it, the split says your part, and marking it paid is the whole transaction. PIECES have no
// figure, because coupons are single-trade and only they can sell them, so all this can do is say how
// many of yours they hold and take whatever they send.
//
// Nothing here computes a meso. Every number comes off lib/collection.ts, which is lib/wallet.ts's
// and lib/vestige-ledger.ts's.

export function CollectionLedger({
  rows,
  bossByKey,
  partyById,
  busy,
  onAddPayment,
  onSettlePieces,
  onSettleShares,
}: {
  rows: Collection[];
  bossByKey: Map<string, Boss>;
  partyById: Map<string, Party>;
  busy: boolean;
  onAddPayment: (holder: Holder, amount: number) => Promise<void>;
  onSettlePieces: (holder: Holder, lootIds: string[]) => Promise<void>;
  onSettleShares: (payouts: { lootId: string; memberId: string }[]) => Promise<void>;
}) {
  if (rows.length === 0) return null;
  return (
    <>
      {rows.map((row) => (
        <CollectionCard
          key={row.key}
          row={row}
          bossByKey={bossByKey}
          partyById={partyById}
          busy={busy}
          onAddPayment={onAddPayment}
          onSettlePieces={onSettlePieces}
          onSettleShares={onSettleShares}
        />
      ))}
    </>
  );
}

function CollectionCard({
  row,
  bossByKey,
  partyById,
  busy,
  onAddPayment,
  onSettlePieces,
  onSettleShares,
}: {
  row: Collection;
  bossByKey: Map<string, Boss>;
  partyById: Map<string, Party>;
  busy: boolean;
  onAddPayment: (holder: Holder, amount: number) => Promise<void>;
  onSettlePieces: (holder: Holder, lootIds: string[]) => Promise<void>;
  onSettleShares: (payouts: { lootId: string; memberId: string }[]) => Promise<void>;
}) {
  const [got, setGot] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);

  const payment = parseMesos(got);
  const paid = payment !== null && payment >= 1 ? payment : null;

  async function write(action: Promise<void>, clear: boolean) {
    setRefusal(null);
    try {
      await action;
      if (clear) setGot("");
    } catch (e) {
      setRefusal(e instanceof Error ? e.message : "That didn't save.");
    }
  }

  // Each half only when there is one. The mesos are already netted, so "in shares" is one figure
  // rather than two directions. `owedByYou` is on a row that got here on its pieces alone, and it is
  // said so those are not chased off somebody you are behind with.
  const summary = [
    row.pieces > 0 ? `${row.pieces} pieces` : null,
    row.mesos > 0 ? `${shortMesos(row.mesos)} in shares` : null,
    row.owedByYou > 0 ? `you owe ${shortMesos(row.owedByYou)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section className="ledger-card">
      <header className="ledger-head">
        <span className="loot-title">
          <span className="loot-name">{row.name}</span>
          <span className="loot-meta">{summary}</span>
        </span>
        {row.received > 0 && (
          <span className="ledger-tally">
            <span className="loot-share-nets">{shortMesos(row.received)} received</span>
          </span>
        )}
      </header>

      {/* The shares: a figure, and one button that marks every one of them paid. Same act the
          Wallet performs, against the same payout rows, so the two cannot disagree. */}
      {row.lines.length > 0 && (
        <div className="ledger-entry">
          <span className="ledger-step">shares</span>
          <ul className="ledger-queue">
            {row.lines.map((line) => {
              const boss = bossByKey.get(line.bossKey ?? "");
              const party = partyById.get(line.partyId);
              return (
                <li key={`${line.lootId}:${line.theirsId}`} className="ledger-drop">
                  <div className="ledger-drop-head">
                    <Link href={`/bosses/parties/${line.partyId}`} className="loot-name">
                      {line.name}
                    </Link>
                    <span className="loot-meta">
                      {boss ? bossLabel(boss.name, party?.difficulty ?? null) : "Unknown boss"} ·{" "}
                      {line.theirs}
                    </span>
                    <span className="droplog-take">{formatMesos(line.nets, true)}</span>
                  </div>
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            className="party-save"
            disabled={busy}
            onClick={() => void write(onSettleShares(sharesOf(row)), false)}
          >
            Mark paid
          </button>
        </div>
      )}

      {/* The pieces: a count, whatever has arrived against it, and the act that closes it. No price,
          because coupons are single-trade and what they fetched is not something this can see. */}
      {row.pieces > 0 && row.holder !== null && (
        <div className="ledger-entry">
          <span className="ledger-step">pieces</span>
          <ul className="ledger-queue">
            {row.drops.map((drop) => {
              const boss = bossByKey.get(drop.bossKey ?? "");
              const party = partyById.get(drop.partyId);
              return (
                <li key={drop.lootId} className="ledger-drop">
                  <div className="ledger-drop-head">
                    <Link href={`/bosses/parties/${drop.partyId}`} className="loot-name">
                      {boss ? bossLabel(boss.name, party?.difficulty ?? null) : "Unknown boss"}
                    </Link>
                    <span className="loot-meta">
                      {drop.looterName} · week of {formatWeekStart(drop.weekStart)}
                    </span>
                    <span className="droplog-take">{drop.pieces}</span>
                  </div>
                </li>
              );
            })}
          </ul>

          <form
            className="ledger-sale"
            onSubmit={(e) => {
              e.preventDefault();
              if (paid && row.holder) void write(onAddPayment(row.holder, paid), true);
            }}
          >
            <label className="loot-share-input">
              paid me
              <input
                className="split-input"
                value={got}
                onChange={(e) => setGot(e.target.value)}
                inputMode="decimal"
                aria-label={`What ${row.name} has paid you`}
              />
            </label>
            <button type="submit" className="party-save" disabled={busy || paid === null}>
              Add
            </button>
          </form>

          <span className="ledger-settle">
            <button
              type="button"
              className="party-save"
              disabled={busy}
              onClick={() =>
                row.holder &&
                void write(
                  onSettlePieces(
                    row.holder,
                    row.drops.map((d) => d.lootId),
                  ),
                  false,
                )
              }
            >
              Mark settled
            </button>
            <span className="ledger-progress">
              {`closes ${row.drops.length} ${row.drops.length === 1 ? "boss" : "bosses"}`}
            </span>
          </span>
        </div>
      )}

      {refusal && <span className="split-error">{refusal}</span>}
    </section>
  );
}
