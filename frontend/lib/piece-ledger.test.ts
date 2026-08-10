import { describe, expect, it } from "vitest";
import {
  type LedgerSeat,
  type PieceSale,
  allocate,
  balances,
  entitlements,
  saleProgress,
  spreadKept,
  transferKey,
  transfersOf,
} from "./piece-ledger";

const M = 1_000_000;

const seat = (name: string, looted: number, shares = 1): LedgerSeat => ({
  memberId: `m-${name}`,
  name,
  looted,
  shares,
});

/** The night this exists for: Extreme Kalos, six bundles of 30, four people. */
const kalos = (looted: [number, number, number, number]) => [
  seat("Rune", looted[0]),
  seat("Steve", looted[1]),
  seat("Bob", looted[2]),
  seat("Ana", looted[3]),
];

describe("what each seat was entitled to", () => {
  it("divides evenly when it divides", () => {
    const share = entitlements(180, kalos([120, 60, 0, 0]));
    expect([...share.values()]).toEqual([45, 45, 45, 45]);
  });

  it("hands the odd pieces out rather than losing them", () => {
    // 181 across four is 45.25 each. Somebody gets the 46th piece, and the four still add to 181.
    const share = entitlements(181, kalos([181, 0, 0, 0]));
    expect([...share.values()].reduce((a, b) => a + b, 0)).toBe(181);
    expect([...share.values()].sort((a, b) => b - a)).toEqual([46, 45, 45, 45]);
  });

  it.each([
    [7, 3],
    [100, 3],
    [181, 4],
    [1, 4],
    [359, 6],
    [0, 4],
  ])("always adds up to what dropped: %i across %i", (total, size) => {
    const seats = Array.from({ length: size }, (_, i) => seat(`s${i}`, 0));
    const share = entitlements(total, seats);
    expect([...share.values()].reduce((a, b) => a + b, 0)).toBe(total);
  });

  it("gives a bigger weight a bigger entitlement", () => {
    const share = entitlements(180, [seat("Rune", 0, 2), seat("Steve", 0), seat("Bob", 0)]);
    expect(share.get("m-Rune")).toBe(90);
    expect(share.get("m-Steve")).toBe(45);
  });

  it("is the same answer twice, so a paid transfer does not move", () => {
    const seats = kalos([100, 81, 0, 0]);
    expect([...entitlements(181, seats)]).toEqual([...entitlements(181, seats)]);
  });
});

describe("who is over and who is short", () => {
  it("nets to zero, so the transfers can clear it exactly", () => {
    const position = balances(180, kalos([120, 60, 0, 0]));
    expect(position.map((p) => p.balance)).toEqual([-75, -15, 45, 45]);
    expect(position.reduce((sum, p) => sum + p.balance, 0)).toBe(0);
  });

  it("says nothing is owed when everybody took their share", () => {
    const position = balances(180, kalos([45, 45, 45, 45]));
    expect(position.every((p) => p.balance === 0)).toBe(true);
  });
});

describe("selling a stack in tranches", () => {
  const sales: PieceSale[] = [
    { pieces: 100, priceEach: 25 * M },
    { pieces: 80, priceEach: 24 * M },
  ];

  it("adds the tranches up and averages what was really got", () => {
    const progress = saleProgress(180, sales);
    expect(progress.piecesSold).toBe(180);
    expect(progress.gross).toBe(4_420_000_000);
    expect(progress.averagePrice).toBeCloseTo(24_555_555.56, 1);
    expect(progress.complete).toBe(true);
    expect(progress.unsold).toBe(0);
  });

  it("counts down what is left while the price is still moving", () => {
    const progress = saleProgress(180, [sales[0]!]);
    expect(progress.piecesSold).toBe(100);
    expect(progress.unsold).toBe(80);
    expect(progress.complete).toBe(false);
  });

  it("says nothing has sold rather than averaging over nothing", () => {
    const progress = saleProgress(180, []);
    expect(progress.averagePrice).toBeNull();
    expect(progress.complete).toBe(false);
  });

  it("flags more sold than dropped, which is a miscount", () => {
    const progress = saleProgress(180, [{ pieces: 200, priceEach: 25 * M }]);
    expect(progress.oversold).toBe(true);
    expect(progress.complete).toBe(false);
  });
});

describe("the queue: first cleared, first paid", () => {
  const drop = (id: string, weekStart: string, order: number, total: number, looted: number) => ({
    id,
    weekStart,
    order,
    total,
    seats: [seat("Rune", looted), seat("Steve", 0), seat("Bob", 0), seat("Ana", 0)],
  });

  // Week one: Kalos then Limbo. Week two: Baldrix.
  const queue = [
    drop("kalos", "2026-07-16", 1, 180, 180),
    drop("limbo", "2026-07-16", 2, 60, 60),
    drop("baldrix", "2026-07-23", 3, 120, 120),
  ];

  it("fills the oldest boss first, whatever order the drops arrive in", () => {
    const covered = allocate([...queue].reverse(), [{ pieces: 200, priceEach: 25 * M }]);
    expect(covered.get("kalos")!.complete).toBe(true);
    expect(covered.get("limbo")!.covered).toBe(20);
    expect(covered.get("limbo")!.complete).toBe(false);
    expect(covered.get("baldrix")!.covered).toBe(0);
  });

  it("pays a boss out as soon as its own pieces are covered, not the whole pile", () => {
    // The rule this replaced would have waited for all 360, which next week's clear pushes out of
    // reach again.
    const covered = allocate(queue, [{ pieces: 180, priceEach: 25 * M }]);
    expect(transfersOf(queue[0]!, covered.get("kalos"))[0]!.send).toBe(1_125_000_000);
    expect(transfersOf(queue[1]!, covered.get("limbo"))[0]!.send).toBeNull();
  });

  it("prices a boss from the tranches that actually covered it", () => {
    const covered = allocate(queue, [
      { pieces: 100, priceEach: 25 * M },
      { pieces: 80, priceEach: 24 * M },
    ]);
    expect(covered.get("kalos")!.averagePrice).toBeCloseTo(24_555_555.56, 1);
    expect(transfersOf(queue[0]!, covered.get("kalos"))[0]!.send).toBe(1_105_000_000);
  });

  it("splits one tranche across two bosses when it spans them", () => {
    const covered = allocate(queue, [{ pieces: 240, priceEach: 20 * M }]);
    expect(covered.get("kalos")!.complete).toBe(true);
    expect(covered.get("limbo")!.complete).toBe(true);
    expect(covered.get("limbo")!.averagePrice).toBe(20 * M);
    expect(covered.get("baldrix")!.covered).toBe(0);
  });

  it("cannot re-price a boss that is already covered, which is why nothing is stored", () => {
    // The property FIFO buys: a later tranche drains into the NEXT boss, so a figure somebody has
    // already been paid stays the figure they were paid.
    const before = allocate(queue, [{ pieces: 180, priceEach: 25 * M }]);
    const after = allocate(queue, [
      { pieces: 180, priceEach: 25 * M },
      { pieces: 500, priceEach: 1 * M },
    ]);
    expect(after.get("kalos")).toEqual(before.get("kalos"));
    expect(after.get("limbo")!.averagePrice).toBe(1 * M);
  });

  it("says nothing at all for a boss looted the way it divides", () => {
    const even = {
      id: "even",
      weekStart: "2026-07-16",
      order: 1,
      total: 180,
      seats: kalos([45, 45, 45, 45]),
    };
    const covered = allocate([even], [{ pieces: 180, priceEach: 25 * M }]);
    expect(transfersOf(even, covered.get("even"))).toEqual([]);
  });

  it("pays pro rata as the stack goes, rather than nothing until the last piece", () => {
    // Half of Kalos has sold, so half of each debt is due. The rule this replaced said null here
    // and left three people waiting on a stack that may sit for weeks.
    const covered = allocate(queue, [{ pieces: 90, priceEach: 25 * M }]);
    const out = transfersOf(queue[0]!, covered.get("kalos"));
    // 45 pieces of 180 is a quarter of the drop, so a quarter of the 2.25b it has made.
    expect(out.map((t) => [t.pieces, t.settled, t.send])).toEqual([
      [45, 22, 562_500_000],
      [45, 22, 562_500_000],
      [45, 22, 562_500_000],
    ]);
  });

  it("comes to the same money as waiting would have, and never revises an instalment", () => {
    const half = allocate(queue, [{ pieces: 90, priceEach: 25 * M }]);
    const all = allocate(queue, [
      { pieces: 90, priceEach: 25 * M },
      // The price fell between the two lots, which is the case that would move a running average.
      { pieces: 90, priceEach: 20 * M },
    ]);

    const first = transfersOf(queue[0]!, half.get("kalos"))[0]!;
    const final = transfersOf(queue[0]!, all.get("kalos"))[0]!;

    // Cumulative, so the first instalment is a prefix of the total and is never taken back.
    expect(final.send! - first.send!).toBe(450_000_000);
    // And the total is exactly what one payment at the end would have been: 45 at the 22.5m average.
    expect(all.get("kalos")!.averagePrice).toBe(22.5 * M);
    expect(final.send).toBe(45 * 22.5 * M);
    expect(final.settled).toBe(45);
  });

  it("keys a transfer by the pair, so paid survives a redraw", () => {
    const covered = allocate(queue, [{ pieces: 180, priceEach: 25 * M }]);
    const out = transfersOf(queue[0]!, covered.get("kalos"));
    expect(out.map(transferKey)).toEqual(["m-Rune>m-Steve", "m-Rune>m-Bob", "m-Rune>m-Ana"]);
  });

  it("rounds a debt up, so the person waiting is not the one short", () => {
    const odd = {
      id: "odd",
      weekStart: "2026-07-16",
      order: 1,
      total: 3,
      seats: [seat("A", 3), seat("B", 0), seat("C", 0)],
    };
    const covered = allocate(
      [odd],
      [
        { pieces: 2, priceEach: 5 },
        { pieces: 1, priceEach: 4 },
      ],
    );
    expect(transfersOf(odd, covered.get("odd")).map((t) => [t.pieces, t.send])).toEqual([
      [1, 5],
      [1, 5],
    ]);
  });
});

describe("a holder who redeems part of their pile", () => {
  // 390 in one drop, a duo, Bro looted the lot. 195 of it is the other seat's.
  const drop = (kept?: number) => ({
    id: "limbo",
    weekStart: "2026-08-03",
    order: 1,
    total: 390,
    held: 390,
    kept,
    seats: [seat("Bro", 390), seat("Mine", 0)],
  });

  const sold = (pieces: number) => [{ pieces, priceEach: 25 * M }];

  it("pays the whole claim from the sellable pile, not the fraction of the pile that sold", () => {
    // #281: over the whole 390 this said 2.44b, half of a claim that was fully realized. Bro kept
    // his own 195 and sold the other seat's 195, so all of those proceeds are theirs.
    const covered = allocate([drop(195)], sold(195));
    const out = transfersOf(drop(195), covered.get("limbo"))[0]!;
    expect(out.pieces).toBe(195);
    expect(out.send).toBe(195 * 25 * M);
    expect(out.settled).toBe(195);
    expect(covered.get("limbo")!.complete).toBe(true);
  });

  it("is unchanged for a pile with nothing kept, which is every drop before this existed", () => {
    const covered = allocate([drop()], sold(390));
    const out = transfersOf(drop(), covered.get("limbo"))[0]!;
    expect(out.send).toBe(195 * 25 * M);
    expect(covered.get("limbo")!.sellable).toBe(390);
  });

  it("still pays in instalments while the sellable part is going", () => {
    // Bro keeps his 195 and has shifted 100 of the other seat's. Every one of those is theirs.
    const covered = allocate([drop(195)], sold(100));
    const out = transfersOf(drop(195), covered.get("limbo"))[0]!;
    expect(out.send).toBe(100 * 25 * M);
    expect(out.settled).toBe(100);
    expect(covered.get("limbo")!.complete).toBe(false);
  });

  it("charges a holder who keeps more than their share, at the price their own sales got", () => {
    // Keeping 250 of 390 eats 55 pieces that are not his. Only 140 are left to sell, so the 4.88b
    // owed is more than the 3.5b he took in: the difference is what eating them costs.
    const covered = allocate([drop(250)], sold(140));
    const out = transfersOf(drop(250), covered.get("limbo"))[0]!;
    expect(covered.get("limbo")!.cost).toBe(140 * 25 * M);
    expect(out.send).toBe(195 * 25 * M);
    expect(out.settled).toBe(195);
  });

  it("refuses to price a wholly kept pile rather than inventing a figure for it", () => {
    const covered = allocate([drop(390)], []);
    const out = transfersOf(drop(390), covered.get("limbo"))[0]!;
    expect(covered.get("limbo")!.sellable).toBe(0);
    // Not complete, because there is no realized price and so no debt that can be stated.
    expect(covered.get("limbo")!.complete).toBe(false);
    expect(out.pieces).toBe(195);
    expect(out.send).toBeNull();
    expect(out.settled).toBe(0);
  });

  it("lets the queue flow past a wholly kept boss to the next one", () => {
    const first = { ...drop(390), id: "first", order: 1 };
    const second = { ...drop(), id: "second", order: 2 };
    const covered = allocate([first, second], sold(390));
    // The kept boss took none of the tranche, so all of it reached the boss behind it.
    expect(covered.get("first")!.covered).toBe(0);
    expect(covered.get("second")!.covered).toBe(390);
    expect(covered.get("second")!.complete).toBe(true);
  });

  it("treats keeping more than the pile as keeping the pile, not as a negative one", () => {
    const covered = allocate([drop(999)], sold(10));
    expect(covered.get("limbo")!.sellable).toBe(0);
    expect(transfersOf(drop(999), covered.get("limbo"))[0]!.send).toBeNull();
  });
});

describe("which bosses the redeemed pieces come off", () => {
  // Three weeks in the queue, 100 pieces each, oldest first.
  const pile = [
    { id: "old", weekStart: "2026-07-16", order: 1, total: 100, seats: [seat("A", 100)] },
    { id: "mid", weekStart: "2026-07-23", order: 1, total: 100, seats: [seat("A", 100)] },
    { id: "new", weekStart: "2026-07-30", order: 1, total: 100, seats: [seat("A", 100)] },
  ];

  const keptOn = (kept: number) =>
    Object.fromEntries(spreadKept(pile, kept).map((d) => [d.id, d.kept ?? 0]));

  it("takes them off the newest end, so the oldest boss keeps its price", () => {
    expect(keptOn(100)).toEqual({ old: 0, mid: 0, new: 100 });
  });

  it("works backwards through the queue once the newest is used up", () => {
    expect(keptOn(150)).toEqual({ old: 0, mid: 50, new: 100 });
  });

  it("never takes more off one boss than that boss holds", () => {
    expect(keptOn(250)).toEqual({ old: 50, mid: 100, new: 100 });
  });

  it("keeps the whole pile rather than overflowing when the count is too big", () => {
    expect(keptOn(9_999)).toEqual({ old: 100, mid: 100, new: 100 });
  });

  it("leaves the drops alone when nothing is kept", () => {
    expect(spreadKept(pile, 0)).toBe(pile);
  });

  it("does not un-price a boss that has already been paid for", () => {
    // The invariant the direction exists for. The oldest boss sold out at 25m and its debt is
    // final; recording a redemption afterwards must not reach back and take its pieces away.
    const sales = [{ pieces: 100, priceEach: 25 * M }];
    const before = allocate(pile, sales).get("old")!;
    const after = allocate(spreadKept(pile, 150), sales).get("old")!;

    expect(before.complete).toBe(true);
    expect(after.complete).toBe(true);
    expect(after.averagePrice).toBe(before.averagePrice);
    expect(after.sellable).toBe(100);

    // Taken off the oldest end instead, that same boss would have had nothing left to sell and its
    // settled price would have vanished. Pinned so the direction cannot be flipped by accident.
    const backwards = allocate([{ ...pile[0]!, kept: 100 }], sales).get("old")!;
    expect(backwards.complete).toBe(false);
    expect(backwards.averagePrice).toBeNull();
  });

  describe("whose pieces they are, before which boss they came off", () => {
    // The same three weeks, but a duo: A looted all 100 each night and half of every one is B's.
    const shared = pile.map((d) => ({ ...d, seats: [seat("A", 100), seat("B", 0)] }));
    const keptFor = (kept: number, holder?: string) =>
      Object.fromEntries(spreadKept(shared, kept, holder).map((d) => [d.id, d.kept ?? 0]));

    it("takes a holder's own share off every boss before touching anybody else's", () => {
      // Their whole entitlement across the pile, so each boss keeps exactly the half that is B's
      // for sale. Off whole bosses instead the newest two had nothing sellable left, B's pieces
      // there could never be priced, and the oldest paid out as though A had sold their own half
      // too: 150 of a 150-piece claim settled as 100.
      expect(keptFor(150, "m-A")).toEqual({ old: 50, mid: 50, new: 50 });
    });

    it("still works newest first within their own share", () => {
      expect(keptFor(80, "m-A")).toEqual({ old: 0, mid: 30, new: 50 });
    });

    it("spills into the pieces they owe once their own share is gone, newest first", () => {
      expect(keptFor(200, "m-A")).toEqual({ old: 50, mid: 50, new: 100 });
    });

    it("reads every piece as theirs when no holder is named", () => {
      expect(keptFor(150)).toEqual({ old: 0, mid: 50, new: 100 });
    });

    it("measures their own share by the SHARES, not by halving the pile", () => {
      // A 2:1 split where the small share loots the lot: 100 a night, and only a third is theirs.
      // These seats are FOLDED holders, which is where a 2 comes from without anybody configuring
      // an uneven split: the config's own control makes "one member takes more" and "one member
      // loots everything" mutually exclusive, but two of one person's characters fold to 2 shares
      // under either. See foldSeats in vestige-ledger.ts.
      const uneven = pile.map((d) => ({ ...d, seats: [seat("A", 100, 1), seat("B", 0, 2)] }));
      const keptOnUneven = (kept: number) =>
        Object.fromEntries(spreadKept(uneven, kept, "m-A").map((d) => [d.id, d.kept ?? 0]));

      // A third of 100 is 33, so their whole entitlement across the pile is 99: the 100th piece is
      // already B's, and it comes off the newest end like any other overshoot.
      expect(keptOnUneven(100)).toEqual({ old: 33, mid: 33, new: 34 });
      // Under it, still off the newest end first.
      expect(keptOnUneven(50)).toEqual({ old: 0, mid: 17, new: 33 });
      // Over it, the surplus is B's pieces, and only then.
      expect(keptOnUneven(150)).toEqual({ old: 33, mid: 33, new: 84 });
    });

    it("hands out the odd piece rather than losing it when the shares do not divide", () => {
      // 100 across a 2:1:1 split is 50 / 25 / 25, and 181 is 90.5 / 45.25 / 45.25. Their own share
      // comes off entitlements(), so the rounding is the same one the balances use.
      const trio = [
        { ...pile[0]!, total: 181, seats: [seat("A", 181, 1), seat("B", 0, 2), seat("C", 0, 1)] },
      ];
      expect(spreadKept(trio, 45, "m-A")[0]!.kept).toBe(45);
      expect(spreadKept(trio, 46, "m-A")[0]!.kept).toBe(46);
    });
  });
});
