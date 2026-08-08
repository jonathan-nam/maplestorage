"use client";

import { apiAssetUrl } from "@/lib/api";
import type { Boss } from "@/types/boss";

// One character's routine: every boss in the catalog, ticked if they run it.
//
// The whole list rather than the exceptions, because the question being answered is "what does this
// character run" and you cannot answer it from a column of the matrix without reading down sixteen
// rows. Ticking it here also means the answer is visible before it is saved, which a cell in the
// grid could not do: there, a mark on a boss already cleared this week would have been written and
// then drawn over by the tick.

// Same grouping the matrix uses, and the planner itself. A monthly boss and a weekly one are not
// counting the same span of time, so they do not sit in one undivided list.
const CADENCE_ORDER = ["MONTHLY", "WEEKLY", "DAILY"];

export function BossRoutineEditor({
  characterName,
  bosses,
  skipped,
  lockedBossKeys,
  isSaving,
  onToggle,
}: {
  characterName: string;
  bosses: Boss[];
  /** Boss keys this character does not run. Everything else in the catalog is ticked. */
  skipped: Set<string>;
  /**
   * Bosses that cannot be un-ticked: a party config already says this character runs them.
   *
   * Drawn locked rather than refused after the click. The config is (character, boss, difficulty,
   * who with), which is the same claim in more detail, so the way to say they stopped running it
   * is to delete the config.
   */
  lockedBossKeys: Set<string>;
  /** Whether THIS box's write is in flight. One flag for the page greyed the whole list on one tick. */
  isSaving: (bossKey: string) => boolean;
  onToggle: (bossKey: string, runs: boolean) => void;
}) {
  const cadences = CADENCE_ORDER.filter((c) => bosses.some((b) => b.reset === c));
  const runningCount = bosses.filter((b) => !skipped.has(b.bossKey)).length;

  return (
    <section className="routine">
      <p className="routine-count">
        {characterName} runs {runningCount} of {bosses.length}.
      </p>

      {cadences.map((cadence) => (
        <div key={cadence} className="routine-group">
          <h2 className="routine-cadence">{cadence}</h2>
          <ul className="routine-list">
            {bosses
              .filter((boss) => boss.reset === cadence)
              .map((boss) => {
                const runs = !skipped.has(boss.bossKey);
                const locked = lockedBossKeys.has(boss.bossKey);
                return (
                  <li key={boss.bossKey} className={`routine-row${runs ? "" : " is-skipped"}`}>
                    <label className="routine-label">
                      <input
                        type="checkbox"
                        className="routine-check"
                        checked={runs}
                        disabled={locked || isSaving(boss.bossKey)}
                        onChange={(e) => onToggle(boss.bossKey, e.target.checked)}
                      />
                      {boss.iconUrl ? (
                        <img className="boss-portrait" src={apiAssetUrl(boss.iconUrl)} alt="" />
                      ) : (
                        <span className="boss-portrait is-empty" aria-hidden="true" />
                      )}
                      <span className="routine-name">{boss.name}</span>
                      {/* Why this one cannot be un-ticked, on the row it applies to. Anywhere else
                          it would be a note about a disabled box you have to go looking for. */}
                      {locked && <span className="routine-locked">has a party</span>}
                    </label>
                  </li>
                );
              })}
          </ul>
        </div>
      ))}
    </section>
  );
}
