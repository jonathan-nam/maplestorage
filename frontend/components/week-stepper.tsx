"use client";

import { weekLabel } from "@/lib/boss-clears";
import type { BossClearsView } from "@/types/boss";

/**
 * Steps the matrix through stored weeks.
 *
 * Both arrows are driven by the server's answer rather than by adding seven days here. An arrow is
 * disabled when the response says there is nothing that way: no stored week before this one, or
 * nowhere newer than the current period. Stepping into a week that was never captured would draw an
 * empty matrix, which is indistinguishable from a week where nothing was cleared.
 */
export function WeekStepper({
  view,
  onSelect,
  busy,
}: {
  view: Pick<
    BossClearsView,
    "weekStart" | "previousWeekStart" | "nextWeekStart" | "currentWeekStart"
  >;
  onSelect: (week: string | null) => void;
  busy?: boolean;
}) {
  const { weekStart, previousWeekStart, nextWeekStart, currentWeekStart } = view;
  const isCurrent = weekStart === null;

  // Stepping forward onto the week in progress means the live view, not a weekly-only slice of it:
  // asking for ?week=<current> would drop the daily and monthly rows off the bottom of the matrix.
  const forward = nextWeekStart === currentWeekStart ? null : nextWeekStart;

  return (
    <div className="week-stepper">
      <button
        type="button"
        className="week-step"
        onClick={() => previousWeekStart && onSelect(previousWeekStart)}
        disabled={busy || !previousWeekStart}
        aria-label="Previous week"
      >
        ‹
      </button>

      {/* aria-live so stepping announces the week that arrived; the arrows themselves say nothing
          about where you landed. */}
      <span className="week-label" aria-live="polite">
        {weekLabel(view)}
      </span>

      <button
        type="button"
        className="week-step"
        onClick={() => nextWeekStart && onSelect(forward)}
        disabled={busy || !nextWeekStart}
        aria-label="Next week"
      >
        ›
      </button>

      {!isCurrent && (
        <button type="button" className="week-today" onClick={() => onSelect(null)} disabled={busy}>
          Today
        </button>
      )}
    </div>
  );
}
