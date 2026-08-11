"use client";

import { apiAssetUrl } from "@/lib/api";
import { formatWeekStart } from "@/lib/boss-clears";
import { bossLabel } from "@/lib/boss-difficulty";
import type { UnansweredDrop } from "@/lib/vestige-ledger";
import type { Boss } from "@/types/boss";
import type { Party } from "@/types/party";

// The nights that did not divide and that nobody has said the arrangement for.
//
// A PROMPT, not a form. It used to carry the chips, and they were the app's only allocation control,
// which meant a night could be answered only while the app could not work it out: one that divided
// evenly, or whose party names a looter, or that was answered wrongly the first time, had no control
// at all. The chips are on the week sheet now, where every night has them.
//
// So what is left here is the thing the sheet cannot say, because the sheet shows one week: across
// ALL of them, these are the nights still owed an answer. Until one is given, its pieces are missing
// from every figure on this tab, and a debt that cannot say who owes it must never go quiet.
//
// Each row moves the sheet to its week. That is the whole interaction: the answer is one place, and
// this is how you get to it.

export function UnansweredNights({
  drops,
  partyById,
  bossByKey,
  iconUrl,
  busy,
  onGoToWeek,
}: {
  drops: UnansweredDrop[];
  partyById: Map<string, Party>;
  bossByKey: Map<string, Boss>;
  /** The coupon's own sprite, backend-relative. Null when the catalog has no art for it. */
  iconUrl: string | null;
  busy: boolean;
  /** Puts the week sheet on this night's week, which is where it is answered. */
  onGoToWeek: (week: string) => void;
}) {
  if (drops.length === 0) return null;

  return (
    <section className="ledger-card">
      {/* The same head as the cards around it, because it is the same coupon. No piece total: it
          would be the sum of numbers already on the rows underneath. */}
      <header className="ledger-head">
        {iconUrl ? (
          <img className="loot-icon" src={apiAssetUrl(iconUrl)} alt="" />
        ) : (
          <span className="loot-icon" aria-hidden="true" />
        )}
        <span className="loot-title">
          <span className="loot-name">Vestige of Erion</span>
        </span>
        <span className="ledger-tally">
          {drops.length} {drops.length === 1 ? "night" : "nights"} unanswered
        </span>
      </header>

      <ul className="ledger-queue">
        {drops.map((drop) => {
          const party = partyById.get(drop.partyId);
          if (!party) return null;
          const boss = bossByKey.get(drop.bossKey ?? "");
          const week = formatWeekStart(drop.weekStart);
          const name = boss ? bossLabel(boss.name, party.difficulty) : "Unknown boss";
          return (
            <li key={drop.lootId} className="ledger-drop">
              <div className="ledger-drop-head">
                <button
                  type="button"
                  className="loot-name"
                  disabled={busy}
                  onClick={() => onGoToWeek(drop.weekStart)}
                  aria-label={`${name}, week of ${week}. Show that week.`}
                >
                  {name}
                </button>
                <span className="loot-meta">
                  {drop.bundles} × {drop.quantity / drop.bundles} · week of {week}
                </span>
                <span className="loot-share-nets">{drop.imbalance} misplaced</span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
