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
  // Copies are interchangeable, so a pile of these sells as one lot at a going rate and the Drop
  // Log can price a queue of rows from one box. False for anything with its own potential lines and
  // its own price, where a queue could only guess which copy went. See lib/lot-sale.ts.
  fungible: boolean;
  // How many pieces this boss drops of it, by difficulty, for the count to be filled in with. Only
  // the difficulties that drop any are here: absent means nothing to fill, not none.
  pieces: Record<string, number>;
  // How many equal stacks those pieces fall in, by difficulty. What a party actually picks up, so
  // it is what makes a share ratio mean anything on screen. Absent for a difficulty nobody has
  // counted the stacks for, which is not a claim that it falls in one.
  bundles: Record<string, number>;
};

// Keyed by boss key, as /api/bosses/drops returns it.
export type DropTables = Record<string, BossDrop[]>;
