import { describe, expect, it } from "vitest";
import {
  type LedgerSeat,
  type PieceSale,
  balances,
  entitlements,
  saleProgress,
  transferKey,
  transfers,
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

describe("the transfers that clear it", () => {
  const sales: PieceSale[] = [
    { pieces: 100, priceEach: 25 * M },
    { pieces: 80, priceEach: 24 * M },
  ];

  it("pays the short seats from the over seats, in seat order", () => {
    const out = transfers(180, kalos([120, 60, 0, 0]), sales);
    expect(out.map((t) => [t.from, t.to, t.pieces])).toEqual([
      ["Rune", "Bob", 45],
      ["Rune", "Ana", 30],
      ["Steve", "Ana", 15],
    ]);
  });

  it("moves exactly the pieces that were over-looted, no more", () => {
    const out = transfers(180, kalos([120, 60, 0, 0]), sales);
    expect(out.reduce((sum, t) => sum + t.pieces, 0)).toBe(90);
  });

  it("says nothing at all on an evenly looted night", () => {
    expect(transfers(180, kalos([45, 45, 45, 45]), sales)).toEqual([]);
  });

  it("values a debt at what the stack really averaged", () => {
    const out = transfers(180, kalos([180, 0, 0, 0]), sales);
    // 45 pieces of a stack that fetched 4.42b over 180 pieces.
    expect(out[0]!.send).toBe(1_105_000_000);
    // The receiver pays the Auction House once, exactly as their own sale would have cost them.
    expect(out[0]!.nets).toBe(1_049_750_000);
    // Nothing is invented: the three debts are the whole stack less the looter's own share.
    expect(out.reduce((sum, t) => sum + (t.send ?? 0), 0)).toBe(3_315_000_000);
  });

  it("refuses to price a debt while pieces are still unsold", () => {
    // The provisional average is about to be changed by the last tranche, so a figure here would be
    // one somebody might act on and it would be wrong.
    const out = transfers(180, kalos([180, 0, 0, 0]), [sales[0]!]);
    expect(out[0]!.pieces).toBe(45);
    expect(out[0]!.send).toBeNull();
    expect(out[0]!.nets).toBeNull();
  });

  it("refuses to price it when more sold than dropped", () => {
    const out = transfers(180, kalos([180, 0, 0, 0]), [{ pieces: 200, priceEach: 25 * M }]);
    expect(out[0]!.send).toBeNull();
  });

  it("rounds a debt up, so the person waiting is not the one short", () => {
    // Three pieces, two sold at 5 and one at 4: an average of 4.67 that no piece actually fetched.
    // A piece owed is worth 5 rather than 4, and the looter absorbs the two thirds.
    const out = transfers(
      3,
      [seat("A", 3), seat("B", 0), seat("C", 0)],
      [
        { pieces: 2, priceEach: 5 },
        { pieces: 1, priceEach: 4 },
      ],
    );
    expect(out.map((t) => [t.pieces, t.send])).toEqual([
      [1, 5],
      [1, 5],
    ]);
  });

  it("keys a transfer by the pair, so paid survives a redraw", () => {
    const out = transfers(180, kalos([120, 60, 0, 0]), sales);
    expect(out.map(transferKey)).toEqual(["m-Rune>m-Bob", "m-Rune>m-Ana", "m-Steve>m-Ana"]);
    expect(new Set(out.map(transferKey)).size).toBe(out.length);
  });

  it("clears a weighted night, where the carry is entitled to more", () => {
    // Rune carried and takes a double share of 180: 72 to him, 36 to each of the others. He looted
    // everything, so he owes each of them 36.
    const out = transfers(
      180,
      [seat("Rune", 180, 2), seat("Steve", 0), seat("Bob", 0), seat("Ana", 0)],
      sales,
    );
    expect(out.map((t) => t.pieces)).toEqual([36, 36, 36]);
    expect(out.every((t) => t.from === "Rune")).toBe(true);
  });
});
