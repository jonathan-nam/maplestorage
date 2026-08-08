// Mirrors backend's bosses/BossDropResponse.kt field-for-field.

export type BossDrop = {
  dropKey: string;
  name: string;
  // Backend-relative, resolve with apiAssetUrl(). Null when the pinned maplestory.io dataset has
  // no art for it, which is drawn as a blank slot rather than a broken image.
  iconUrl: string | null;
  // ALWAYS or HEROIC when every member gets their own copy. Null when the party gets one to share.
  perMember: string | null;
  // INTERACTIVE for the coupons that do not drop in Reboot. Null means everywhere.
  worlds: string | null;
  quantity: number;
  // How many pieces this boss drops of it, by difficulty, for the count to be filled in with. Only
  // the difficulties that drop any are here: absent means nothing to fill, not none.
  pieces: Record<string, number>;
};

// Keyed by boss key, as /api/bosses/drops returns it.
export type DropTables = Record<string, BossDrop[]>;
