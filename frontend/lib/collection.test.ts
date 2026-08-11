import { describe, expect, it } from "vitest";
import { buildCollection, isEmpty, sharesOf } from "./collection";
import type { Holder, HolderLedger } from "./vestige-ledger";
import type { Counterparty, Wallet, WalletLine } from "./wallet";

const M = 1_000_000;

const SELF: Holder = { kind: "SELF", personId: null, characterName: null };
const BRO: Holder = { kind: "PERSON", personId: "p-bro", characterName: null };
const STRANGER: Holder = { kind: "CHARACTER", personId: null, characterName: "zaddy" };

/** One holder's card, with only the fields the collection reads. */
const ledger = (holder: Holder, name: string, over: Partial<HolderLedger> = {}): HolderLedger => ({
  holder,
  holderName: name,
  pieces: 0,
  owedToYou: 0,
  settledToYou: 0,
  dueNow: 0,
  received: 0,
  settled: false,
  kept: 0,
  ownShare: 0,
  bought: { pieces: 0, paid: 0 },
  soldPieces: 0,
  closed: false,
  writtenOff: 0,
  accounted: 0,
  drops: [],
  ...over,
});

/** One boss row under a holder, owing you `pieces`. */
const owing = (lootId: string, bossKey: string, pieces: number, closed = false) => ({
  lootId,
  partyId: `pa-${lootId}`,
  bossKey,
  weekStart: "2026-08-06",
  looterName: "CreedBratton",
  pieces: pieces * 2,
  kept: 0,
  bought: null,
  closed,
  sellable: pieces * 2,
  covered: 0,
  complete: false,
  averagePrice: null,
  transfers: [
    {
      fromId: "person:p-bro",
      toId: "self",
      from: "Bro",
      to: "you",
      pieces,
      settled: 0,
      send: null,
      nets: null,
    },
  ],
});

const line = (lootId: string, pay: number, direction: "owe" | "owed" = "owed"): WalletLine => ({
  partyId: `pa-${lootId}`,
  lootId,
  name: "Grindstone of Life",
  bossKey: "baldrix",
  droppedOn: "2026-08-08",
  direction,
  bought: false,
  mine: "mechyfechy",
  theirs: "CreedBratton",
  theirsId: `seat-${lootId}`,
  payeeId: `payee-${lootId}`,
  pay,
  nets: Math.floor(pay * 0.95),
});

const counterparty = (key: string, name: string, lines: WalletLine[]): Counterparty => ({
  key,
  name,
  attributed: key.startsWith("person:"),
  owe: 0,
  owed: lines.reduce((sum, l) => sum + l.pay, 0),
  net: 0,
  coupons: 0,
  lines,
});

const wallet = (counterparties: Counterparty[]): Wallet => ({
  counterparties,
  owe: 0,
  owed: 0,
  net: 0,
  unreadable: 0,
  coupons: 0,
  betweenOthers: 0,
  betweenMine: 0,
});

describe("what one person owes you", () => {
  it("puts pieces and shares on ONE row, since it is one person and one conversation", () => {
    const rows = buildCollection(
      [ledger(BRO, "Bro", { owedToYou: 80, drops: [owing("l1", "first-adversary", 80)] })],
      wallet([counterparty("person:p-bro", "Bro", [line("l2", 900 * M)])]),
    );
    expect(rows).toHaveLength(1);
    expect([rows[0]!.name, rows[0]!.pieces, rows[0]!.mesos]).toEqual(["Bro", 80, 900 * M]);
  });

  it("states the pieces and never a price for them", () => {
    // The whole point of the redesign: coupons are single-trade, so what they are worth is not
    // something the app can see. A meso figure here would be a guess at somebody else's sale.
    const rows = buildCollection(
      [ledger(BRO, "Bro", { owedToYou: 80, drops: [owing("l1", "first-adversary", 80)] })],
      wallet([]),
    );
    expect(rows[0]!.pieces).toBe(80);
    expect(rows[0]!.mesos).toBe(0);
    expect(Object.keys(rows[0]!)).not.toContain("piecesWorth");
  });

  it("counts only YOUR part of their pile, not everything they picked up", () => {
    // They are holding 160; 80 of those are yours. Their own half is their business.
    const rows = buildCollection(
      [ledger(BRO, "Bro", { owedToYou: 80, drops: [owing("l1", "first-adversary", 80)] })],
      wallet([]),
    );
    expect(rows[0]!.drops[0]!.pieces).toBe(80);
  });
});

describe("who belongs on the list at all", () => {
  it("leaves your own pile off, since you cannot owe yourself", () => {
    const rows = buildCollection([ledger(SELF, "you", { pieces: 200 })], wallet([]));
    expect(rows).toEqual([]);
  });

  it("leaves a closed pile off, because it is finished", () => {
    const rows = buildCollection(
      [
        ledger(BRO, "Bro", {
          owedToYou: 80,
          closed: true,
          drops: [owing("l1", "kalos", 80, true)],
        }),
      ],
      wallet([]),
    );
    expect(rows).toEqual([]);
  });

  it("leaves a closed BOSS off a pile that is still open", () => {
    const rows = buildCollection(
      [
        ledger(BRO, "Bro", {
          owedToYou: 80,
          drops: [owing("l1", "kalos", 90, true), owing("l2", "first-adversary", 80)],
        }),
      ],
      wallet([]),
    );
    expect(rows[0]!.drops.map((d) => d.lootId)).toEqual(["l2"]);
  });

  it("leaves out a share you owe THEM, which runs the other way", () => {
    const rows = buildCollection(
      [],
      wallet([counterparty("person:p-bro", "Bro", [line("l2", 900 * M, "owe")])]),
    );
    expect(rows).toEqual([]);
  });

  it("keeps an unattributed character as their own row, rather than guessing", () => {
    const rows = buildCollection(
      [ledger(STRANGER, "Zaddy", { owedToYou: 30, drops: [owing("l1", "limbo", 30)] })],
      wallet([]),
    );
    expect([rows[0]!.name, rows[0]!.attributed]).toEqual(["Zaddy", false]);
  });
});

describe("the order the rows come out in", () => {
  it("leads with the mesos, which is the half you can act on today", () => {
    const rows = buildCollection(
      [
        ledger(BRO, "Bro", { owedToYou: 500, drops: [owing("l1", "kalos", 500)] }),
        ledger(STRANGER, "Zaddy", { owedToYou: 10, drops: [owing("l3", "limbo", 10)] }),
      ],
      wallet([counterparty("character:zaddy", "Zaddy", [line("l4", 900 * M)])]),
    );
    expect(rows.map((r) => r.name)).toEqual(["Zaddy", "Bro"]);
  });

  it("breaks a tie on pieces, then the name, so two reads never disagree", () => {
    const rows = buildCollection(
      [
        ledger(BRO, "Bro", { owedToYou: 10, drops: [owing("l1", "kalos", 10)] }),
        ledger(STRANGER, "Zaddy", { owedToYou: 80, drops: [owing("l2", "limbo", 80)] }),
      ],
      wallet([]),
    );
    expect(rows.map((r) => r.name)).toEqual(["Zaddy", "Bro"]);
  });
});

describe("what a settle would touch", () => {
  it("names the payout rows of the shares, and nothing of the pieces", () => {
    // The trap this exists for: a piece debt has NO payout row, so naming one clears nothing while
    // looking as though it worked. That is why coupon debt was kept out of the wallet's lines.
    const rows = buildCollection(
      [ledger(BRO, "Bro", { owedToYou: 80, drops: [owing("l1", "first-adversary", 80)] })],
      wallet([counterparty("person:p-bro", "Bro", [line("l2", 900 * M)])]),
    );
    expect(sharesOf(rows[0]!)).toEqual([{ lootId: "l2", memberId: "payee-l2" }]);
  });

  it("carries the holder for the piece side, which is what a payment is filed against", () => {
    const rows = buildCollection(
      [ledger(BRO, "Bro", { owedToYou: 80, drops: [owing("l1", "first-adversary", 80)] })],
      wallet([]),
    );
    expect(rows[0]!.holder).toEqual(BRO);
  });

  it("has no holder for somebody who owes only shares, since there is no pile", () => {
    const rows = buildCollection(
      [],
      wallet([counterparty("person:p-jared", "Jared", [line("l9", 400 * M)])]),
    );
    expect(rows[0]!.holder).toBeNull();
    expect(isEmpty(rows[0]!)).toBe(false);
  });
});
