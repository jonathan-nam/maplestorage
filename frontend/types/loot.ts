// Mirrors backend's parties/LootDtos.kt field-for-field.

export type LootPayout = {
  memberId: string;
  paid: boolean;
  paidAt: string | null;
  // Shares of the pot this member takes, pinned when the drop sold. 1 in an even split.
  shares: number;
};

export type Loot = {
  id: string;
  // Set when the drop came from a boss table; customName is set instead when it was typed.
  dropKey: string | null;
  customName: string | null;
  // Already resolved to whichever of the two applies.
  name: string;
  iconUrl: string | null;
  // ALWAYS or HEROIC when each member gets their own copy, so pooling it is not what it needs.
  perMember: string | null;
  bossKey: string | null;
  // How many of it fell. 1 for a drop that is one item; a stack of coupons is one row with its
  // count, which is what a night that will not divide evenly leaves one member holding.
  quantity: number;
  droppedOn: string;
  // The reset week droppedOn falls in, as that week's Thursday. The server's, so the Drop Log's
  // weeks are the same ones the clears matrix steps through. See BossPeriod.kt.
  weekStart: string;
  // PENDING, SOLD or PAID_OUT. Derived by the server from the sale and the payout rows.
  status: string;
  saleAmount: number | null;
  // LISTED, RECEIVED, or BOUGHT when a party member bought it off the party (no Auction House cut
  // off the top). Read by basisOf() in lib/loot.ts, which refuses anything else.
  amountBasis: string | null;
  // LAZY or FAIR.
  splitMethod: string | null;
  // The seller's own share count, pinned with the sale. Null until it sells.
  sellerShares: number | null;
  // Who holds the value and owes the rest: the seller, or the buyer on a BOUGHT basis.
  sellerMemberId: string | null;
  soldAt: string | null;
  // Who is owed, pinned when the drop sold. Empty before that.
  payouts: LootPayout[];
  // Seat ids of who ran the week this drop FELL in. Who may be named as its seller and who a sale
  // will owe, which is neither the party as it stands now nor every seat it has ever had.
  ranThatWeek: string[];
};

// One party's whole pool, from GET /api/parties/loot. Grouped by party because reading a split
// needs that party's seats.
export type PartyLootPool = {
  partyId: string;
  loot: Loot[];
};

export type AddLootBody = {
  dropKey?: string | null;
  customName?: string | null;
  bossKey?: string | null;
  // How many fell. Omitted is 1, which is every drop that is one item.
  quantity?: number;
  droppedOn?: string | null;
};

// POST /api/parties/loot. A drop named by character and boss, for the Drop Log: the pool is the
// server's to resolve, since a boss run alone has no party to name and may not have a pool yet.
export type LogDropBody = {
  characterId: string;
  bossKey: string;
  dropKey?: string | null;
  customName?: string | null;
  quantity?: number;
};

export type SellLootBody = {
  amount: number;
  amountBasis: string;
  splitMethod: string;
  sellerMemberId: string;
  // How many shares each seat takes, keyed by seat id, the seller's own included. A seat left out
  // takes one, so an even split sends nothing at all. Only seats that RAN that week may be named.
  shares?: Record<string, number>;
};

// POST /api/parties/loot/settle. Every payout row one net transfer covers, marked paid together or
// not at all. Built by settlementFor() in lib/wallet.ts, never by hand at a call site.
export type SettleBody = {
  payouts: { lootId: string; memberId: string }[];
};
