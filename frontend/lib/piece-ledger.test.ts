import { describe, expect, it } from "vitest";
import {
  type LedgerSeat,
  type PieceSale,
  allocate,
  balances,
  entitlements,
  saleProgress,
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
