"use client";

import Link from "next/link";
import { useState } from "react";
import { RosterInputs } from "@/components/roster-inputs";
import { apiAssetUrl } from "@/lib/api";
import { formatWeekStart } from "@/lib/boss-clears";
import { bossLabel } from "@/lib/boss-difficulty";
import {
  countKey,
  recordedArrangement,
  stacksBySeat,
  suggestedArrangement,
  type WeekRun,
} from "@/lib/week-runs";
import type { Boss } from "@/types/boss";
import type { Character } from "@/types/character";
import type { Party } from "@/types/party";

// One week's Grandis nights: who was on each of them, and who picked up which stack.
//
// The sheet for a roster that changes every Thursday. Answering a row writes THAT week and leaves
// the config alone, so next week starts blank again instead of inheriting whoever happened to be
// around last time.
//
// Two questions per row, in the order they are asked: who was there, then how the stacks went. The
// second only exists once the first has an answer, because a stack cannot be handed to nobody.
//
// The stacks are here for EVERY night, not only the ones nothing can work out. That was the whole
// of the old control: unanswered() lists a night solely when the app is stuck, so a night that
// divided evenly, or whose party names a looter, or that was answered wrongly the first time, could
// not be said at all. What somebody watched happen must not depend on the app being unable to guess.
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
  behind,
  misplaced,
  iconUrl,
  busy,
  onSave,
  onSaveStacks,
}: {
  runs: WeekRun[];
  /** Every week that dropped one, newest first. */
  weeks: string[];
  week: string;
  onWeek: (week: string) => void;
  bossByKey: Map<string, Boss>;
  characterById: Map<string, Character>;
  partyById: Map<string, Party>;
  /** Each holder's position across what is already recorded, so the odd stack rotates. */
  behind: Map<string, number>;
  /** Pieces that cannot be where they belong, by drop, for the nights nobody has answered. */
  misplaced: Map<string, number>;
  /** The coupon's own sprite, backend-relative. Null when the catalog has no art for it. */
  iconUrl: string | null;
  busy: boolean;
  onSave: (run: WeekRun, members: string[]) => Promise<void>;
  onSaveStacks: (run: WeekRun, bundles: Record<string, number>) => Promise<void>;
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
            behind={behind}
            misplaced={misplaced.get(run.lootId) ?? 0}
            busy={busy}
            onSave={onSave}
            onSaveStacks={onSaveStacks}
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
  behind,
  misplaced,
  busy,
  onSave,
  onSaveStacks,
}: {
  run: WeekRun;
  boss: Boss | undefined;
  characterName: string | null;
  difficulty: string | null;
  behind: Map<string, number>;
  misplaced: number;
  busy: boolean;
  onSave: (run: WeekRun, members: string[]) => Promise<void>;
  onSaveStacks: (run: WeekRun, bundles: Record<string, number>) => Promise<void>;
}) {
  // Keyed on the row's own answer, so a save that lands leaves the boxes holding what was saved.
  // One empty box on a night nobody has answered for, which is what RosterInputs draws a seat from.
  const [members, setMembers] = useState<string[]>(run.others.length > 0 ? run.others : [""]);
  const [refusal, setRefusal] = useState<string | null>(null);

  const named = members.map((m) => m.trim()).filter((m) => m !== "");
  // Whether the boxes still say something the night does not. What acknowledges a save: the row
  // redraws from what the server wrote, this goes false, and the button goes quiet. Nothing else on
  // screen need move, and on a night that divides evenly nothing else would.
  //
  // Compared raw rather than as a set, so two names swapped round is a change. It is: the order is
  // the seats' order, and it is what the roster strip draws.
  const changed = named.join("|").toLowerCase() !== run.others.join("|").toLowerCase();
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
        {/* What happened to it, or what is still wrong with it. Never both: a sold drop's stacks
            are settled whatever they were, and there is nothing left to act on. */}
        {run.locked ? (
          <span className="loot-share-nets">{run.locked}</span>
        ) : (
          misplaced > 0 && <span className="loot-share-nets">{misplaced} misplaced</span>
        )}
      </div>

      {/* A sold night's payouts were pinned from the roster that ran it, so the names are what
          happened and are shown rather than offered. */}
      {run.locked ? (
        <p className="loot-meta">{run.others.join(", ") || "solo"}</p>
      ) : (
        <>
          <div className="loot-actions">
            <RosterInputs members={members} onChange={setMembers} />
            <button
              type="button"
              className="party-save"
              disabled={busy || named.length === 0 || !changed}
              onClick={() => void save()}
            >
              Save
            </button>
          </div>

          {/* Only where there is something to divide. One stack cannot be shared, and a night that
              folds to one holder is that person's three characters holding their own coupons. */}
          {run.bundles !== null && run.bundles > 1 && run.holders > 1 && (
            <StackChips
              // Remounted when the recorded arrangement changes, so a save redraws from what the
              // server wrote rather than from the chips that asked for it.
              //
              // Through countKey, which is sorted. bundlesFor() has no ORDER BY, so the same
              // arrangement can come back with its rows the other way round, and a key that turned
              // on that order would remount these chips while somebody was still clicking them:
              // any save on the page refetches the pools, and their half-made arrangement would
              // vanish with nothing said.
              key={countKey(recordedArrangement(run) ?? [])}
              run={run}
              behind={behind}
              busy={busy}
              onSaveStacks={onSaveStacks}
            />
          )}
        </>
      )}

      {refusal && <span className="split-error">{refusal}</span>}
    </li>
  );
}

/**
 * One chip per STACK, cycling through the seats that ran.
 *
 * The chips are the physical thing somebody bent down for, so the counts always add up to the
 * stacks that fell, which is the only rule the server enforces: an arrangement that does not add up
 * looks answered and measures a debt against stacks nobody accounted for.
 *
 * What it opens on, in the order heldByHolder reads them, so the chips always show what the app
 * currently believes rather than a fresh guess over the top of it:
 *
 *  - the arrangement already recorded, so a wrong one can be corrected rather than only added to.
 *  - the party's agreed looter holding the lot.
 *  - the balanced split, odd stack to whoever is furthest behind.
 *
 * Suggested, never pre-saved: the suggestion moves when an earlier week is edited, and a stored
 * guess would rewrite nights already settled.
 */
function StackChips({
  run,
  behind,
  busy,
  onSaveStacks,
}: {
  run: WeekRun;
  behind: Map<string, number>;
  busy: boolean;
  onSaveStacks: (run: WeekRun, bundles: Record<string, number>) => Promise<void>;
}) {
  const seats = run.seats;
  const bundles = run.bundles ?? 0;
  const recorded = recordedArrangement(run);
  const [owners, setOwners] = useState<string[]>(
    () => recorded ?? suggestedArrangement(run, behind),
  );
  const [refusal, setRefusal] = useState<string | null>(null);

  const size = run.quantity / bundles;
  const nameOf = (id: string) => seats.find((s) => s.id === id)?.name ?? "?";
  // Against what is RECORDED, not against what the chips opened on. A suggestion is not an answer,
  // so a night nobody has said still offers Save; one already saved goes quiet until it is moved.
  const changed = recorded === null || countKey(owners) !== countKey(recorded);

  function cycle(at: number) {
    setOwners((was) =>
      was.map((id, i) => {
        if (i !== at) return id;
        const next = seats.findIndex((s) => s.id === id) + 1;
        return seats[next % seats.length]!.id;
      }),
    );
  }

  async function save() {
    setRefusal(null);
    try {
      await onSaveStacks(run, Object.fromEntries(stacksBySeat(owners)));
    } catch (e) {
      setRefusal(e instanceof Error ? e.message : "That didn't save.");
    }
  }

  return (
    <>
      <ul className="stack-chips">
        {owners.map((id, i) => (
          // Keyed by position: the chips ARE the stacks, and two stacks held by one seat are two of
          // them rather than one that counts twice.
          <li key={i}>
            <button
              type="button"
              className="stack-chip"
              disabled={busy}
              onClick={() => cycle(i)}
              aria-label={`Stack ${i + 1} of ${bundles}, ${size} pieces, picked up by ${nameOf(id)}. Change.`}
            >
              {nameOf(id)}
            </button>
          </li>
        ))}
        <li>
          <button
            type="button"
            className="party-save"
            disabled={busy || !changed}
            onClick={() => void save()}
          >
            Save
          </button>
        </li>
      </ul>
      {refusal && <span className="split-error">{refusal}</span>}
    </>
  );
}
