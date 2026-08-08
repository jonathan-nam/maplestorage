// Mirrors backend's parties/VestigeRoutes.kt field-for-field.

import type { Holder } from "@/lib/vestige-ledger";

// One tranche: "sold 50 pieces for 1.2b". It names no boss, because which boss its pieces paid for
// is worked out by lib/piece-ledger.ts rather than typed. See VestigeRoutes.kt.
export type VestigeTranche = {
  id: string;
  // Whose pile it is: a person, you, or a character nobody has claimed yet. Never a character of
  // somebody you have named, since one human's inventories are one pile. See V39.
  holder: Holder;
  pieces: number;
  // Mesos for the whole tranche. The per-piece figure is derived on every read, never stored.
  amount: number;
  soldAt: string;
};

// POST /api/vestige-tranches. Answers with the whole tally, not the row added.
export type AddVestigeTrancheBody = {
  holder: Holder;
  pieces: number;
  amount: number;
};
