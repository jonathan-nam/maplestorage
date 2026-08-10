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
  // on a KEPT row alone, which realized nothing. See V50.
  amount: number | null;
  // Read rather than inferred, the same way holder.kind is: with three kinds and two of them
  // carrying money, the amount can no longer say which this is.
  disposition: VestigeDisposition;
  soldAt: string;
};

/**
 * What happened to the pieces. All three take them out of the sellable pile.
 *
 * KEPT is redeemed rather than sold, and never more than the holder's own share. Not the same as a
 * sale for nothing: that prices the pieces at zero and makes the creditor absorb half of it, which
 * is what #281 was.
 *
 * BOUGHT is the creditor's pieces taken by the holder at an agreed price, paid to that creditor in
 * full rather than divided pro rata: these never went to market, so there is no pile to divide. It
 * is what lets KEPT be bounded at all. See V50.
 */
export type VestigeDisposition = "SOLD" | "KEPT" | "BOUGHT";

// POST /api/vestige-tranches. Answers with the whole tally, not the row added.
export type AddVestigeTrancheBody = {
  holder: Holder;
  pieces: number;
  // Absent on a KEPT row and required on the other two. The server refuses the two disagreeing,
  // matching the check in V50.
  amount?: number;
  disposition: VestigeDisposition;
};
