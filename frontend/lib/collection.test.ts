import { describe, expect, it } from "vitest";
import { buildCollection, isEmpty, sharesOf, stillOnSaleLedger } from "./collection";
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
  received: 0,
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
  closed,
  transfers: [{ fromId: "person:p-bro", toId: "self", from: "Bro", to: "you", pieces }],
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

const counterparty = (key: string, name: string, lines: WalletLine[]): Counterparty => {
  const owed = lines.filter((l) => l.direction === "owed").reduce((sum, l) => sum + l.pay, 0);
  const owe = lines.filter((l) => l.direction === "owe").reduce((sum, l) => sum + l.pay, 0);
  return {
    key,
    name,
    attributed: key.startsWith("person:"),
    owe,
    owed,
    net: owed - owe,
    lines,
  };
};

const wallet = (counterparties: Counterparty[]): Wallet => ({
  counterparties,
  owe: 0,
  owed: 0,
  net: 0,
  unreadable: 0,
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
});

describe("netting, which is mesos against mesos and never pieces", () => {
  it("nets the two directions to one figure", () => {
    // They owe you 1b of shares and you owe them 400m: one transfer of 600m settles both, and the
    // 400m that no longer crosses saves its 5% hop.
    const rows = buildCollection(
      [],
      wallet([
        counterparty("person:p-bro", "Bro", [line("l1", 1_000 * M), line("l2", 400 * M, "owe")]),
      ]),
    );
    expect(rows[0]!.mesos).toBe(600 * M);
    expect(rows[0]!.owedByYou).toBe(0);
  });

  it("drops them off the list when the netting leaves YOU behind", () => {
    // Jonathan's case: they record a sale owing you 1b, you already owed them 1.5b, so you owe 500m.
    // That is not something to collect, so it is not on the ledger for collecting.
    const rows = buildCollection(
      [],
      wallet([
        counterparty("person:p-bro", "Bro", [line("l1", 1_000 * M), line("l2", 1_500 * M, "owe")]),
      ]),
    );
    expect(rows).toEqual([]);
  });

  it("says what you owe when their PIECES put them on the list anyway", () => {
    // So a pile is not chased off somebody you are 500m behind with.
    const rows = buildCollection(
      [ledger(BRO, "Bro", { owedToYou: 80, drops: [owing("l3", "first-adversary", 80)] })],
      wallet([
        counterparty("person:p-bro", "Bro", [line("l1", 1_000 * M), line("l2", 1_500 * M, "owe")]),
      ]),
    );
    expect([rows[0]!.pieces, rows[0]!.mesos, rows[0]!.owedByYou]).toEqual([80, 0, 500 * M]);
  });

  it("carries no share line once the netting runs against you, so Mark paid cannot reach one", () => {
    // Settling what YOU owe is a different act. A button here that marked those rows paid would
    // clear a debt of yours off a card about collecting.
    const rows = buildCollection(
      [ledger(BRO, "Bro", { owedToYou: 80, drops: [owing("l3", "first-adversary", 80)] })],
      wallet([counterparty("person:p-bro", "Bro", [line("l2", 1_500 * M, "owe")])]),
    );
    expect(sharesOf(rows[0]!)).toEqual([]);
  });

  it("settles BOTH directions when the net runs to you, since one transfer covers them", () => {
    const rows = buildCollection(
      [],
      wallet([
        counterparty("person:p-bro", "Bro", [line("l1", 1_000 * M), line("l2", 400 * M, "owe")]),
      ]),
    );
    expect(sharesOf(rows[0]!).map((s) => s.lootId)).toEqual(["l1", "l2"]);
  });

  it("never nets a piece debt against a meso one", () => {
    // The two are not commensurable: a piece has no price until somebody names one, and the sides
    // come off different nights at different prices.
    const rows = buildCollection(
      [ledger(BRO, "Bro", { owedToYou: 80, drops: [owing("l3", "first-adversary", 80)] })],
      wallet([counterparty("person:p-bro", "Bro", [line("l2", 400 * M, "owe")])]),
    );
    expect(rows[0]!.pieces).toBe(80);
    expect(rows[0]!.owedByYou).toBe(400 * M);
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

describe("which piles the Sale Ledger still draws", () => {
  const has =
    (...keys: string[]) =>
    (key: string) =>
      keys.includes(key);

  it("keeps yours, which are the only ones you can sell out of", () => {
    const { yours, history } = stillOnSaleLedger([ledger(SELF, "you")], has());
    expect(yours).toHaveLength(1);
    expect(history).toEqual([]);
  });

  it("drops somebody else's pile that has nothing recorded against it", () => {
    // Every debt from here on. It is stated on the Collection Ledger, in pieces, and nowhere else:
    // two cards claiming what one person owes is two answers.
    const { yours, history } = stillOnSaleLedger([ledger(BRO, "Bro")], has());
    expect([yours, history]).toEqual([[], []]);
  });

  it("keeps somebody else's pile that has rows, because they are correctable nowhere else", () => {
    const { history } = stillOnSaleLedger([ledger(BRO, "Bro")], has("person:p-bro"));
    expect(history.map((l) => l.holderName)).toEqual(["Bro"]);
  });

  it("never files your own pile as history, however much is recorded against it", () => {
    const { yours, history } = stillOnSaleLedger([ledger(SELF, "you")], has("self"));
    expect(yours).toHaveLength(1);
    expect(history).toEqual([]);
  });

  it("splits a mixed list without losing anybody", () => {
    const all = [ledger(SELF, "you"), ledger(BRO, "Bro"), ledger(STRANGER, "Zaddy")];
    const { yours, history } = stillOnSaleLedger(all, has("person:p-bro"));
    expect(yours.map((l) => l.holderName)).toEqual(["you"]);
    expect(history.map((l) => l.holderName)).toEqual(["Bro"]);
  });
});
