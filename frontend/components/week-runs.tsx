"use client";

import Link from "next/link";
import { useState } from "react";
import { RosterInputs } from "@/components/roster-inputs";
import { apiAssetUrl } from "@/lib/api";
import { formatWeekStart } from "@/lib/boss-clears";
import { bossLabel } from "@/lib/boss-difficulty";
import type { WeekRun } from "@/lib/week-runs";
import type { Boss } from "@/types/boss";
import type { Character } from "@/types/character";
import type { Party } from "@/types/party";

// One week's Grandis nights, and who was on each of them.
//
// The sheet for a roster that changes every Thursday. Answering a row writes THAT week and leaves
// the config alone, so next week starts blank again instead of inheriting whoever happened to be
// around last time.
//
// One week at a time, chosen rather than stepped: the weeks are the ones that actually dropped a
// coupon, so there is nothing to land on that would draw an empty sheet.
//
// Save takes at least one name. Putting a week back to nobody is Party View's control, and it is
// the one thing this card cannot say without explaining itself: a night with no names is the state
// every row starts in.

export function WeekRuns({
  runs,
  weeks,
  week,
  onWeek,
  bossByKey,
  characterById,
  partyById,
  iconUrl,
  busy,
  onSave,
}: {
  runs: WeekRun[];
  /** Every week that dropped one, newest first. */
  weeks: string[];
  week: string;
  onWeek: (week: string) => void;
  bossByKey: Map<string, Boss>;
  characterById: Map<string, Character>;
  partyById: Map<string, Party>;
  /** The coupon's own sprite, backend-relative. Null when the catalog has no art for it. */
  iconUrl: string | null;
  busy: boolean;
  onSave: (run: WeekRun, members: string[]) => Promise<void>;
}) {
  if (weeks.length === 0) return null;

  return (
    <section className="ledger-card">
      <header className="ledger-head">
        {iconUrl ? (
          <img className="loot-icon" src={apiAssetUrl(iconUrl)} alt="" />
        ) : (
          <span className="loot-icon" aria-hidden="true" />
        )}
        <span className="loot-title">
          <span className="loot-name">Vestige of Erion</span>
        </span>
        <select
          className="split-input"
          value={week}
          aria-label="Week"
          disabled={busy}
          onChange={(e) => onWeek(e.target.value)}
        >
          {weeks.map((w) => (
            <option key={w} value={w}>
              {formatWeekStart(w)}
            </option>
          ))}
        </select>
      </header>

      <ul className="ledger-queue">
        {runs.map((run) => (
          <RunRow
            key={run.lootId}
            run={run}
            boss={bossByKey.get(run.bossKey)}
            characterName={characterById.get(run.characterId)?.name ?? null}
            difficulty={partyById.get(run.partyId)?.difficulty ?? null}
            busy={busy}
            onSave={onSave}
          />
        ))}
      </ul>
    </section>
  );
}

function RunRow({
  run,
  boss,
  characterName,
  difficulty,
  busy,
  onSave,
}: {
  run: WeekRun;
  boss: Boss | undefined;
  characterName: string | null;
  difficulty: string | null;
  busy: boolean;
  onSave: (run: WeekRun, members: string[]) => Promise<void>;
}) {
  // Keyed on the row's own answer, so a save that lands leaves the boxes holding what was saved.
  // One empty box on a night nobody has answered for, which is what RosterInputs draws a seat from.
  const [members, setMembers] = useState<string[]>(run.others.length > 0 ? run.others : [""]);
  const [refusal, setRefusal] = useState<string | null>(null);

  const named = members.map((m) => m.trim()).filter((m) => m !== "");
  // The stack size, which is what somebody actually bent down for. Only where the drop falls in
  // more than one: "180 in 1 stack" is the same fact as 180, said twice.
  const stacks = run.bundles !== null && run.bundles > 1 ? ` in ${run.bundles} stacks` : "";
  const meta = [characterName, `${run.quantity}${stacks}`].filter(Boolean).join(" · ");

  async function save() {
    setRefusal(null);
    try {
      await onSave(run, named);
    } catch (e) {
      setRefusal(e instanceof Error ? e.message : "That didn't save.");
    }
  }

  return (
    <li className="ledger-drop">
      <div className="ledger-drop-head">
        {/* Linked like the ledger's rows: one boss can be run by two of your characters, and which
            pool this is cannot be read off the boss name alone. */}
        <Link href={`/bosses/parties/${run.partyId}`} className="loot-name">
          {boss ? bossLabel(boss.name, difficulty) : "Unknown boss"}
        </Link>
        <span className="loot-meta">{meta}</span>
        {run.locked && <span className="loot-share-nets">{run.locked}</span>}
      </div>

      {/* A sold night's payouts were pinned from the roster that ran it, so the names are what
          happened and are shown rather than offered. */}
      {run.locked ? (
        <p className="loot-meta">{run.others.join(", ") || "solo"}</p>
      ) : (
        <div className="loot-actions">
          <RosterInputs members={members} onChange={setMembers} />
          <button
            type="button"
            className="party-save"
            disabled={busy || named.length === 0}
            onClick={() => void save()}
          >
            Save
          </button>
        </div>
      )}

      {refusal && <span className="split-error">{refusal}</span>}
    </li>
  );
}
