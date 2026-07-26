// Mirrors backend's parties/PartyDtos.kt field-for-field.

export type PartyMember = {
  id: string;
  name: string;
  // Set when the seat is one of your characters, null when it is somebody else. This link is what
  // answers "which parties is this character in".
  characterId: string | null;
  // Whether they pay the MVP Auction House rate. A status, not a rate: the rates live in
  // lib/drop-split.ts and are read from there wherever money is worked out.
  mvp: boolean;
};

export type Party = {
  id: string;
  // Null when never named. Label it with partyLabel(), which falls back to the roster.
  name: string | null;
  members: PartyMember[];
  // Catalog keys, in progression order. The names come from /api/bosses, the same catalog the
  // clear matrix draws its rows from.
  bossKeys: string[];
  // The pool at a glance: dropped but unsold, and sold with somebody still unpaid.
  pendingLoot: number;
  awaitingPayout: number;
  createdAt: string;
  updatedAt: string;
};

// A seat as submitted. `id` keeps an existing seat rather than replacing it, which matters because
// loot payouts point at seat rows. See PartyMemberRequest.
export type PartyMemberDraft = {
  id?: string;
  name: string;
  characterId: string | null;
  mvp: boolean;
};

// The whole party, every time: a save replaces the seats and the boss list rather than patching
// them. Seats left out are removed.
export type SavePartyBody = {
  name: string | null;
  members: PartyMemberDraft[];
  bossKeys: string[];
};
