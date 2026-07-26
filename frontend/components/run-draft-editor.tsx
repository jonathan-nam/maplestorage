"use client";

import { BOSS_NAMES } from "@/lib/boss-art";
import type { DraftRun } from "@/lib/boss-night";
import { DEFAULT_MINUTES } from "@/lib/boss-minutes";
import { MAX_PARTY } from "@/lib/parties";

const BOSS_KEYS = Object.keys(BOSS_NAMES);

/**
 * The next free run id.
 *
 * Counted off the ids in hand rather than off the list LENGTH, which repeats one as soon as a run
 * is removed, and a repeated id makes two rows edit as though they were one.
 */
function nextId(drafts: DraftRun[]): string {
  const used = drafts.map((run) => Number(run.id.replace("run-", ""))).filter(Number.isFinite);
  return `run-${Math.max(0, ...used) + 1}`;
}

/** A fresh run, ready to be added to the ones already there. */
export function newDraftRun(drafts: DraftRun[]): DraftRun {
  return blankRun(nextId(drafts));
}

/** A fresh run, pre-seated so the form opens on something you can type into. */
function blankRun(id: string): DraftRun {
  const bossKey = BOSS_KEYS[0] as string;
  return {
    id,
    bossKey,
    bossName: BOSS_NAMES[bossKey] as string,
    minutes: DEFAULT_MINUTES,
    seats: [
      { character: "", person: "" },
      { character: "", person: "" },
    ],
  };
}

/**
 * Typing in the same thing a party config holds: a boss, and who brings which character.
 *
 * Deliberately the same shape as the signed-in side rather than a simplified one. The ordering
 * cannot be done without knowing which character each person is on, so a form that asked only for
 * names would be a form that could not answer the question.
 */
export function RunDraftEditor({
  drafts,
  onChange,
}: {
  drafts: DraftRun[];
  onChange: (drafts: DraftRun[]) => void;
}) {
  const update = (id: string, change: (run: DraftRun) => DraftRun) =>
    onChange(drafts.map((run) => (run.id === id ? change(run) : run)));

  return (
    <div className="run-drafts">
      {drafts.map((run) => (
        <div key={run.id} className="run-draft">
          <div className="run-draft-head">
            <select
              className="split-input"
              value={run.bossKey}
              aria-label="Boss"
              onChange={(e) =>
                update(run.id, (r) => ({
                  ...r,
                  bossKey: e.target.value,
                  bossName: BOSS_NAMES[e.target.value] ?? e.target.value,
                }))
              }
            >
              {BOSS_KEYS.map((key) => (
                <option key={key} value={key}>
                  {BOSS_NAMES[key]}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="party-delete"
              onClick={() => onChange(drafts.filter((r) => r.id !== run.id))}
            >
              Remove
            </button>
          </div>

          <ul className="run-draft-seats">
            {run.seats.map((seat, i) => (
              // Seats are positions in a form, not entities. Nothing else to key on, and
              // reordering is not offered, so the index is stable for as long as the row lives.
              <li key={i} className="run-draft-seat">
                <input
                  className="split-input"
                  value={seat.character}
                  placeholder="Character"
                  aria-label={`Character ${i + 1}`}
                  onChange={(e) =>
                    update(run.id, (r) => ({
                      ...r,
                      seats: r.seats.map((s, j) =>
                        j === i ? { ...s, character: e.target.value } : s,
                      ),
                    }))
                  }
                />
                <input
                  className="split-input"
                  value={seat.person}
                  placeholder="Who plays it"
                  aria-label={`Player ${i + 1}`}
                  onChange={(e) =>
                    update(run.id, (r) => ({
                      ...r,
                      seats: r.seats.map((s, j) =>
                        j === i ? { ...s, person: e.target.value } : s,
                      ),
                    }))
                  }
                />
                <button
                  type="button"
                  className="party-cancel"
                  aria-label={`Remove seat ${i + 1}`}
                  disabled={run.seats.length <= 1}
                  onClick={() =>
                    update(run.id, (r) => ({ ...r, seats: r.seats.filter((_, j) => j !== i) }))
                  }
                >
                  &times;
                </button>
              </li>
            ))}
          </ul>

          {run.seats.length < MAX_PARTY && (
            <button
              type="button"
              className="party-add-seat"
              onClick={() =>
                update(run.id, (r) => ({
                  ...r,
                  seats: [...r.seats, { character: "", person: "" }],
                }))
              }
            >
              Add a seat
            </button>
          )}
        </div>
      ))}

      <button
        type="button"
        className="party-save"
        onClick={() => onChange([...drafts, blankRun(nextId(drafts))])}
      >
        Add a run
      </button>
    </div>
  );
}
