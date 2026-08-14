// The Sale Ledger and the Settlement Ledger, over ONE set of data, asked what one night still owes.
//
// They are different questions asked of the same debt: the Sale Ledger asks what a PILE of yours still
// owes out, and the Settlement Ledger asks what stands between you and one PERSON. So they draw the
// same night from opposite ends, and for as long as each reduced it by its own rule they could put two
// figures on screen at once. Jonathan read 60 on one and 20 on the other off one Extreme Kalos night.
//
// Nothing else can hold this. Each file's own tests pin its own rule, and both passed the whole time.

import { describe, expect, it } from "vitest";
import { heldOfYoursBy, outstandingOf, queueOf } from "./ledger-fates";
import { buildSettlement } from "./settlement";
import {
  type Holder,
  type HolderLedger,
  answeredByHolder,
  answeredByPair,
  boughtByHolder,
  holderLedgers,
  keptByHolder,
  outstanding,
  salesByHolder,
} from "./vestige-ledger";
import type { Wallet } from "./wallet";
import type { Loot, PartyLootPool } from "@/types/loot";
import type { Party, PartyMember } from "@/types/party";

const M = 1_000_000;
const VESTIGE = "vestige-of-erion";
const ORDER = new Map([["limbo", 6]]);
const SELF: Holder = { kind: "SELF", personId: null, characterName: null };
const BRO: Holder = { kind: "PERSON", personId: "p-bro", characterName: null };
const BRO_KEY = "person:p-bro";

/** Nothing has a price on either card, so the wallet is empty and every figure here is a count. */
const NO_WALLET: Wallet = {
  counterparties: [],
  owe: 0,
  owed: 0,
  net: 0,
  unreadable: 0,
  betweenOthers: 0,
  betweenMine: 0,
};

const seat = (id: string, name: string, mine: boolean): PartyMember => ({
  id,
  name,
  personId: mine ? null : "p-bro",
  personName: mine ? null : "Bro",
  characterId: mine ? `char-${id}` : null,
  spriteImgUrl: null,
  guest: false,
  shares: 1,
});

const SEATS = [seat("m1", "Husky", true), seat("m2", "BroChar", false)];

const party = (id: string, looter: string): Party => ({
  id,
  characterId: "char-m1",
  solo: false,
  oneOff: false,
  retired: false,
  worldType: "INTERACTIVE",
  bossKey: "limbo",
  difficulty: "HARD",
  minutes: null,
  looterMemberId: looter,
  members: SEATS,
  seats: SEATS,
  usualRoster: true,
  skippedThisPeriod: false,
  pendingLoot: 0,
  awaitingPayout: 0,
  settledLoot: 0,
  cleared: null,
  clearedByHand: false,
  createdAt: "2026-07-01T00:00:00Z",
  updatedAt: "2026-07-01T00:00:00Z",
});

const coupon = (id: string, quantity: number, droppedOn: string): Loot => ({
  id,
  dropKey: VESTIGE,
  customName: null,
  name: "Vestige of Erion Coupon",
  iconUrl: null,
  perMember: null,
  bossKey: "limbo",
  quantity,
  droppedOn,
  weekStart: "2026-08-06",
  status: "PENDING",
  saleAmount: null,
  amountBasis: null,
  splitMethod: null,
  sellerShares: null,
  sellerMemberId: null,
  takenByMemberId: null,
  soldAt: null,
  payouts: [],
  ranThatWeek: [],
  bundles: null,
  bundlesBy: [],
});

/**
 * The shape both ledgers draw: a night in each inventory, and a sale that priced part of one.
 *
 * You looted all 60 of the first, so 30 of them are Bro's. Bro looted all 30 of the second, so 15 of
 * those are yours. A sale out of your pile then named 10 of Bro's. Three subtractions on one debt,
 * which is what makes it worth asking both cards the same question.
 */
const bothPiles = (theirs: number) => {
  const parties = [party("pa", "m1"), party("pb", "m2")];
  const pools: PartyLootPool[] = [
    { partyId: "pa", loot: [coupon("l1", 60, "2026-08-06")] },
    { partyId: "pb", loot: [coupon("l2", 30, "2026-08-07")] },
  ];
  const rows =
    theirs > 0
      ? [
          {
            holder: SELF,
            pieces: theirs,
            amount: 20 * theirs * M,
            disposition: "SOLD",
            shares: [{ holder: BRO, pieces: theirs }],
          },
        ]
      : [];
  const ledgers = holderLedgers(
    outstanding(parties, pools, VESTIGE, ORDER),
    salesByHolder(rows),
    keptByHolder(rows),
    boughtByHolder(rows),
    undefined,
    undefined,
    answeredByHolder(rows),
    answeredByPair(rows),
  );
  return { ledgers, rows };
};

const selfPile = (ledgers: HolderLedger[]) => ledgers.find((l) => l.holder.kind === "SELF")!;

/** What the Sale Ledger's queue says one night still owes one creditor. */
const saleLedgerSays = (ledgers: HolderLedger[], lootId: string, creditor: string) => {
  const { owing } = queueOf(selfPile(ledgers), heldOfYoursBy(ledgers));
  const night = owing.find((n) => n.lootId === lootId);
  return (night?.transfers ?? [])
    .filter((t) => t.toId === creditor)
    .reduce((sum, t) => sum + t.pieces, 0);
};

/** What the Settlement Ledger's card says the same night still owes the same person. */
const settlementLedgerSays = (
  ledgers: HolderLedger[],
  rows: Parameters<typeof answeredByPair>[0],
  lootId: string,
  creditor: string,
) => {
  const [row] = buildSettlement(
    ledgers,
    NO_WALLET,
    [],
    new Map(),
    new Map(),
    new Map(),
    new Set([creditor]),
    answeredByPair(rows),
  );
  return (row?.owedDrops ?? [])
    .filter((d) => d.lootId === lootId)
    .reduce((sum, d) => sum + d.pieces, 0);
};

describe("the two ledgers agree on one night", () => {
  it("premise: they are looking at the same 30-piece debt off the same night", () => {
    const { ledgers } = bothPiles(0);
    expect(selfPile(ledgers).drops.map((d) => d.lootId)).toEqual(["l1"]);
    expect(heldOfYoursBy(ledgers).get(BRO_KEY)).toBe(15);
  });

  it("says the same thing where a sale part-answered the night", () => {
    // 30 owed, 10 priced by the sale and 15 cancelled by Bro's own coupons, so 5 are outstanding. The
    // Sale Ledger drew 30 here and the Settlement Ledger drew 5.
    const { ledgers, rows } = bothPiles(10);
    expect(saleLedgerSays(ledgers, "l1", BRO_KEY)).toBe(5);
    expect(settlementLedgerSays(ledgers, rows, "l1", BRO_KEY)).toBe(5);
  });

  it("says the same thing with nothing sold, where only their own coupons cancel", () => {
    const { ledgers, rows } = bothPiles(0);
    expect(saleLedgerSays(ledgers, "l1", BRO_KEY)).toBe(15);
    expect(settlementLedgerSays(ledgers, rows, "l1", BRO_KEY)).toBe(15);
  });

  it("both drop the night once the answers cover it", () => {
    const { ledgers, rows } = bothPiles(15);
    expect(saleLedgerSays(ledgers, "l1", BRO_KEY)).toBe(0);
    expect(settlementLedgerSays(ledgers, rows, "l1", BRO_KEY)).toBe(0);
  });

  it("the Sale Ledger's header is what its own rows come to", () => {
    // #416's rule, on the other ledger. Every figure on the card comes off one spend, so this cannot
    // be arranged to fail by feeding it a night the credit only part covers.
    for (const theirs of [0, 5, 10, 15, 40]) {
      const { ledgers } = bothPiles(theirs);
      const { owing } = queueOf(selfPile(ledgers), heldOfYoursBy(ledgers));
      const listed = owing.flatMap((n) => n.transfers).reduce((sum, t) => sum + t.pieces, 0);
      expect(listed).toBe(outstandingOf(selfPile(ledgers), heldOfYoursBy(ledgers)));
    }
  });
});
