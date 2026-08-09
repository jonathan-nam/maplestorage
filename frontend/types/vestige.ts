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
  // Mesos for the whole tranche. The per-piece figure is derived on every read, never stored. Null
  // on a KEPT row, which has no sale and so no price. See V46.
  amount: number | null;
  // SOLD or KEPT. Read rather than inferred from a missing amount, the same way holder.kind is.
  disposition: VestigeDisposition;
  soldAt: string;
};

/**
 * What happened to the pieces.
 *
 * KEPT is redeemed rather than sold, and comes out of the pile every price is derived from. Not the
 * same as a sale for nothing: that prices the pieces at zero and makes the creditor absorb half of
 * it, which is what #281 was.
 */
export type VestigeDisposition = "SOLD" | "KEPT";

// POST /api/vestige-tranches. Answers with the whole tally, not the row added.
export type AddVestigeTrancheBody = {
  holder: Holder;
  pieces: number;
  // Absent on a KEPT row. The server refuses the two disagreeing, matching the check in V46.
  amount?: number;
  disposition: VestigeDisposition;
};
