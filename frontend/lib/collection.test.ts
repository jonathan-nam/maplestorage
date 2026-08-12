import { describe, expect, it } from "vitest";
import { buildCollection, isEmpty, sharesOf, stillOnSaleLedger } from "./collection";
import { receivedSinceClosing, saleCredits } from "./vestige-ledger";
import type { Holder, HolderLedger } from "./vestige-ledger";
import type { Counterparty, Wallet, WalletLine } from "./wallet";
import type { CollectionDebt } from "@/types/vestige";

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

  it("keeps a share you owe THEM, said as what you owe rather than as something to collect", () => {
    // It used to be dropped, which was right while every figure here ran one way. It is not now:
    // the ordinary end of looting a boss single-handed is a debt of YOURS, and a card that showed
    // only the collectable direction would not mention the money of theirs in your hands.
    const rows = buildCollection(
      [],
      wallet([counterparty("person:p-bro", "Bro", [line("l2", 900 * M, "owe")])]),
    );
    expect([rows[0]!.mesos, rows[0]!.owedByYou]).toEqual([0, 900 * M]);
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

  it("says which way it runs when the netting leaves YOU behind", () => {
    // They record a sale owing you 1b, you already owed them 1.5b, so you owe 500m. Not collectable,
    // and still the one thing outstanding between you.
    const rows = buildCollection(
      [],
      wallet([
        counterparty("person:p-bro", "Bro", [line("l1", 1_000 * M), line("l2", 1_500 * M, "owe")]),
      ]),
    );
    expect([rows[0]!.mesos, rows[0]!.owedByYou]).toEqual([0, 500 * M]);
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

  it("rebuilds the holder for somebody with no pile, so an entry can still be filed against them", () => {
    // It used to be null, which was fine while the only thing a card wrote was against a pile. An
    // entered debt is filed against the PERSON, and somebody who has never held a coupon can owe you.
    const rows = buildCollection(
      [],
      wallet([counterparty("person:p-jared", "Jared", [line("l9", 400 * M)])]),
    );
    expect(rows[0]!.holder).toEqual({
      kind: "PERSON",
      personId: "p-jared",
      characterName: null,
    });
    expect(isEmpty(rows[0]!)).toBe(false);
  });
});

describe("the money a sale of somebody else's coupons puts on the card", () => {
  const debt = (holder: Holder, amount: number, note: string | null = null): CollectionDebt => ({
    id: `d-${amount}`,
    holder,
    amount,
    note,
    incurredAt: "2026-08-10T00:00:00Z",
  });

  it("owes them what their half of the lot fetched, the night you looted all of it", () => {
    // The case this was built for. 160 fell, 80 were theirs, you picked up the lot and sold it. Their
    // 80 came out of YOUR inventory at a price you typed, so their money is in your hands.
    const rows = buildCollection(
      [],
      wallet([]),
      [],
      saleCredits([
        { holder: SELF, pieces: 160, amount: 4_000 * M, shares: [{ holder: BRO, pieces: 80 }] },
      ]),
      new Map(),
      new Map([["person:p-bro", "Bro"]]),
    );
    expect([rows[0]!.name, rows[0]!.mesos, rows[0]!.owedByYou]).toEqual(["Bro", 0, 2_000 * M]);
  });

  it("deducts that sale from what they already owed you, which is one net to settle", () => {
    // Jonathan's ask in one line: an amount entered for a person, and item sales coming off it.
    const rows = buildCollection(
      [],
      wallet([]),
      [debt(BRO, 3_000 * M, "Ludi loan")],
      saleCredits([
        { holder: SELF, pieces: 160, amount: 4_000 * M, shares: [{ holder: BRO, pieces: 80 }] },
      ]),
    );
    expect(rows[0]!.mesos).toBe(1_000 * M);
    expect([rows[0]!.parts.entered, rows[0]!.parts.soldOfTheirs]).toEqual([3_000 * M, -2_000 * M]);
  });

  it("prices only the pieces that were said to be theirs, never the whole sale", () => {
    // A partial sale: 100 of the 160 went, and 80 of those were theirs because somebody typed 80.
    // Nothing infers which coupons in one inventory went to market.
    const rows = buildCollection(
      [],
      wallet([]),
      [],
      saleCredits([
        { holder: SELF, pieces: 100, amount: 2_500 * M, shares: [{ holder: BRO, pieces: 80 }] },
      ]),
    );
    expect(rows[0]!.owedByYou).toBe(2_000 * M);
  });

  it("credits nobody for a sale that named no shares, which is every row before V56", () => {
    const rows = buildCollection(
      [],
      wallet([]),
      [],
      saleCredits([{ holder: SELF, pieces: 160, amount: 4_000 * M }]),
    );
    expect(rows).toEqual([]);
  });

  it("divides no redemption and no purchase, since neither has proceeds to share", () => {
    // A KEPT row realized nothing and a BOUGHT row is already one creditor's in full. The server
    // refuses shares on both; this is the reader agreeing with it.
    const credits = saleCredits([
      { holder: SELF, pieces: 80, amount: null, shares: [{ holder: BRO, pieces: 80 }] },
      {
        holder: SELF,
        pieces: 80,
        amount: 2_000 * M,
        disposition: "BOUGHT",
        shares: [{ holder: BRO, pieces: 80 }],
      },
    ]);
    expect(credits.size).toBe(0);
  });

  it("leaves a sale between two other people alone, since settling it is not yours", () => {
    // The same treatment buildWallet gives betweenOthers. Real, and not a debt of yours either way.
    const credits = saleCredits([
      { holder: BRO, pieces: 80, amount: 2_000 * M, shares: [{ holder: STRANGER, pieces: 80 }] },
    ]);
    expect(credits.size).toBe(0);
  });

  it("takes a payment off what they owe, whether or not they ever held a coupon", () => {
    // Received used to be read off the HolderLedger, so a person with no open drop had none at all.
    const rows = buildCollection(
      [],
      wallet([]),
      [debt(BRO, 1_000 * M)],
      new Map(),
      new Map([["person:p-bro", 400 * M]]),
    );
    expect([rows[0]!.mesos, rows[0]!.parts.received]).toEqual([600 * M, -400 * M]);
  });

  it("never turns a payment into a debt of YOURS, when the pieces it paid for have no price", () => {
    // They hold 80 of yours and send 400m for them. Netting that would read "you owe them 400m",
    // which is the plausible confident wrong number: the pieces have no price for it to come off.
    const rows = buildCollection(
      [ledger(BRO, "Bro", { owedToYou: 80, drops: [owing("l1", "kalos", 80)] })],
      wallet([]),
      [],
      new Map(),
      new Map([["person:p-bro", 400 * M]]),
    );
    expect([rows[0]!.mesos, rows[0]!.owedByYou]).toEqual([0, 0]);
    expect([rows[0]!.parts.received, rows[0]!.receivedOnPieces]).toEqual([0, 400 * M]);
  });

  it("spends a payment on the priced debt first, and says what is left over", () => {
    const rows = buildCollection(
      [ledger(BRO, "Bro", { owedToYou: 80, drops: [owing("l1", "kalos", 80)] })],
      wallet([]),
      [debt(BRO, 500 * M)],
      new Map(),
      new Map([["person:p-bro", 900 * M]]),
    );
    expect(rows[0]!.mesos).toBe(0);
    expect([rows[0]!.parts.received, rows[0]!.receivedOnPieces]).toEqual([-500 * M, 400 * M]);
  });

  it("spends a payment that already closed a pile, so it cannot pay for the next debt", () => {
    // Jonathan's live data, 2026-08-12. Bro sold 195 coupons for 4.856b, sent 4.86b, and the pile
    // was settled twenty minutes later. Counted raw, that finished payment came straight off the
    // 254b entered against him today. #350's rule, one ledger further along: a closed thing counts
    // towards no current total.
    const paid = [
      { holder: BRO, amount: 4_860 * M, receivedAt: "2026-08-10T22:01:46Z" },
      { holder: BRO, amount: 500 * M, receivedAt: "2026-08-11T09:00:00Z" },
    ];
    const closed = [{ holder: BRO, settledAt: "2026-08-10T22:21:53Z" }];

    // Only the one that arrived after the books closed.
    expect(receivedSinceClosing(paid, closed)).toEqual(new Map([["person:p-bro", 500 * M]]));

    const rows = buildCollection(
      [],
      wallet([]),
      [debt(BRO, 254_000 * M)],
      new Map(),
      receivedSinceClosing(paid, closed),
    );
    expect(rows[0]!.mesos).toBe(253_500 * M);
  });

  it("counts every payment when no pile has ever been closed", () => {
    const paid = [{ holder: BRO, amount: 400 * M, receivedAt: "2026-08-10T22:01:46Z" }];
    expect(receivedSinceClosing(paid, [])).toEqual(new Map([["person:p-bro", 400 * M]]));
  });

  it("closes one person's books without spending another's payments", () => {
    const paid = [
      { holder: BRO, amount: 400 * M, receivedAt: "2026-08-10T22:01:46Z" },
      { holder: STRANGER, amount: 900 * M, receivedAt: "2026-08-10T22:01:46Z" },
    ];
    const closed = [{ holder: BRO, settledAt: "2026-08-10T23:00:00Z" }];
    expect(receivedSinceClosing(paid, closed)).toEqual(new Map([["character:zaddy", 900 * M]]));
  });

  it("keeps the pieces out of the net, however much money is on the card", () => {
    // The rule this ledger was split for. A piece has no price until somebody names one, so it is
    // never added to or taken off a meso figure.
    const rows = buildCollection(
      [ledger(BRO, "Bro", { owedToYou: 80, drops: [owing("l1", "kalos", 80)] })],
      wallet([]),
      [debt(BRO, 1_000 * M)],
    );
    expect([rows[0]!.pieces, rows[0]!.mesos]).toEqual([80, 1_000 * M]);
  });

  it("rounds a creditor's slice to the meso and leaves the remainder with the seller", () => {
    // 1 of 3 pieces out of 1000 mesos. The two sides must add up to the tranche exactly, and the
    // person who typed the figure is the one who can check it.
    const credits = saleCredits([
      { holder: SELF, pieces: 3, amount: 1_000, shares: [{ holder: BRO, pieces: 1 }] },
    ]);
    expect(credits.get("person:p-bro")).toEqual({ toThem: 333, toYou: 0 });
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

  it("drops a SETTLED pile, whose rows nobody is going to argue about", () => {
    // Bro's 4.86b sat on the sale page for a debt paid in full and closed the day before, reading
    // as money outstanding. Closing the books is the statement that the transaction is over.
    const { history } = stillOnSaleLedger(
      [ledger(BRO, "Bro", { closed: true })],
      has("person:p-bro"),
    );
    expect(history).toEqual([]);
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
