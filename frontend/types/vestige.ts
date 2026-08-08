// Mirrors backend's parties/VestigeRoutes.kt field-for-field.

// One tranche: "sold 50 pieces for 1.2b". It names no boss, because which boss its pieces paid for
// is worked out by lib/piece-ledger.ts rather than typed. See VestigeRoutes.kt.
export type VestigeTranche = {
  id: string;
  // Lowercased by the server. Match seats through looterKey(), never raw.
  looterName: string;
  pieces: number;
  // Mesos for the whole tranche. The per-piece figure is derived on every read, never stored.
  amount: number;
  soldAt: string;
};

// POST /api/vestige-tranches. Answers with the whole tally, not the row added.
export type AddVestigeTrancheBody = {
  looterName: string;
  pieces: number;
  amount: number;
};
