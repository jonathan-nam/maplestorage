// Mirrors backend's bosses/BossDtos.kt field-for-field.

export type Boss = {
  bossKey: string;
  name: string;
  // WEEKLY / DAILY / MONTHLY. Two bosses in the same matrix are not counting the same span of
  // time, so the cadence has to be visible rather than implied by column position.
  reset: string;
};

export type BossClear = {
  bossKey: string;
  cleared: boolean;
  // The period this row answers for, so nothing here has to recompute a reset boundary.
  periodStart: string;
  capturedAt: string;
};

// Keyed by character id, as /api/bosses/clears returns it.
export type BossClearsByCharacter = Record<string, BossClear[]>;

// One view of the matrix, as /api/bosses/clears returns it. The navigation and the reset instants
// are served, not computed here, so the reset boundary keeps its single implementation in
// bosses/BossPeriod.kt. See BossClearsViewResponse.
export type BossClearsView = {
  clearsByCharacter: BossClearsByCharacter;
  // Null when showing the current period, which spans all three cadences.
  weekStart: string | null;
  // Null at either end of the stored history.
  previousWeekStart: string | null;
  nextWeekStart: string | null;
  // The week now in progress. Stepping forward onto it means returning to the live view.
  currentWeekStart: string;
  // Cadence -> ISO instant of the next rollover. Always about now, even in a history view.
  nextResets: Record<string, string>;
  // The server's clock when it answered, so the countdown does not trust the browser's.
  now: string;
};
