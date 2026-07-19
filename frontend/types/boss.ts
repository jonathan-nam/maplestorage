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
