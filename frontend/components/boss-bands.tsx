"use client";

import {
  type BossBand,
  bandCount,
  bossBands,
  cadenceLabel,
  progressLabel,
} from "@/lib/boss-clears";
import type { Boss, BossClearsByCharacter, BossSkipsByCharacter } from "@/types/boss";
import type { Character } from "@/types/character";

// The totals read the other way up from the table. The table follows the planner, which puts the
// rarest reset first; the totals are read at a glance, and the glance is nearly always at the week.
const TOTALS_ORDER = ["WEEKLY", "MONTHLY", "DAILY"];

/**
 * How much of each cadence is cleared.
 *
 * It sat above the matrix and cost the two bands' worth of height there, which was height the table
 * wanted: the matrix is the page, and it started a screenful down. Beside the page it costs none.
 * The figures are BossMatrix's own (see bossBands), not a second count of the same clears.
 */
export function BossBands({
  bosses,
  characters,
  clearsByCharacter,
  skipsByCharacter,
  loading,
  historyWeek,
}: {
  bosses: Boss[];
  characters: Pick<Character, "id" | "name" | "spriteImgUrl">[];
  clearsByCharacter: BossClearsByCharacter;
  skipsByCharacter?: BossSkipsByCharacter;
  loading?: boolean;
  historyWeek?: string | null;
}) {
  const { bands } = bossBands({
    bosses,
    characters,
    clearsByCharacter,
    skipsByCharacter,
    historyWeek,
    loading,
  });

  return (
    <div className="boss-band-totals">
      {[...bands]
        .sort(
          (a: BossBand, b: BossBand) =>
            TOTALS_ORDER.indexOf(a.cadence) - TOTALS_ORDER.indexOf(b.cadence),
        )
        .map(({ cadence, progress }) => (
          <div key={cadence} className="boss-band-row">
            {/* The band and its figure in one column, so the figure is read where it is said
                rather than at the far end of the bar. */}
            <span className="boss-band-label">
              <span className="boss-band-name">{cadenceLabel(cadence)}</span>
              {/* The bar is a picture of the figure and the figure has dropped the word, so the
                  words go here for a reader with neither. */}
              {!loading && <span className="visually-hidden">{progressLabel(progress)}</span>}
              <span className="boss-band-count" aria-hidden="true">
                {loading ? <span className="skeleton sk-line" /> : bandCount(progress)}
              </span>
            </span>
            {/* Never the bar alone. It is a second reading of the figure beside it, so a
                proportion nobody can state (a past week) keeps the space and draws no track:
                an empty track is a bar reading zero. The figures are withheld while loading for
                the same reason, the skeleton's rows being invented (see SKELETON_BOSSES). */}
            {!loading && progress.total ? (
              <span className="boss-progress-bar" aria-hidden="true">
                <span style={{ width: `${(progress.cleared / progress.total) * 100}%` }} />
              </span>
            ) : (
              <span aria-hidden="true" />
            )}
          </div>
        ))}
    </div>
  );
}
