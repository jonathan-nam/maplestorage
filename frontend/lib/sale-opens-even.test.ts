import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { largestRemainder } from "./piece-ledger";

// A sale opens on an even split, whatever ratio the party's config is on.
//
// `party_member.shares` is the STACK entitlement: the party config's boxes write it, and a duo that
// cannot split three vestige stacks evenly is stored as 1:2. The sale form seeded its boxes from it,
// so that party's every ring and grindstone opened at 1:2 as well. It divides the coupon pile and
// nothing else, which is ranSeats' job.
//
// The lot side of this is pinned by lot-sale.test.ts, which can call the function. There are no
// component tests in this repo, so the form's seed is read off the source, as piece-row-guard does.
//
// One file, because there is one form: LootSaleForm is the boxes on the pool row AND the boxes on
// the Sale Ledger card that prices the same drop. A second copy is what this would stop catching.

const source = (...parts: string[]) =>
  readFileSync(join(__dirname, "..", ...parts), "utf8").replace(/\s+/g, " ");

const form = source("components", "loot-sale-form.tsx");
const row = source("components", "loot-row.tsx");

describe("the sale form's share boxes", () => {
  it("open on one share each", () => {
    expect(form).toContain('const shareOf = (memberId: string) => shares[memberId] ?? "1";');
  });

  it("read no stored ratio, standing or pinned", () => {
    expect(form).not.toContain("sharesThatWeek");
    expect(form).not.toContain("?.shares");
  });

  it("are still typeable, so an uneven split is one box away", () => {
    expect(form).toContain("aria-label={`Shares for ${m.name}`}");
  });

  it("is the only sale form, so the row grew no boxes of its own", () => {
    expect(row).toContain("<LootSaleForm");
    expect(row).not.toContain("loot-share-input");
  });

  it("says what a blank box means, and does not suggest a ratio in its place", () => {
    // Blank is ONE (V44), so an example like "80" sitting in an empty box would state a split
    // nobody typed, which is the confident wrong number this repo exists to prevent.
    expect(form).toContain('placeholder="1"');
  });
});

// The boxes are share counts, and a share count is only meaningful against the others. Two names
// with a 1 in each said nothing about being relative, so each box states the percentage it comes to.
// It is DERIVED: 80 and 20 is the same split as 4 and 1, so the box itself cannot be a percentage.
describe("the percentage a share count comes to", () => {
  const pct = (weights: number[]) => largestRemainder(100, weights);

  it("reads a ratio as the deal it is", () => {
    expect(pct([4, 1])).toEqual([80, 20]);
    expect(pct([80, 20])).toEqual([80, 20]);
  });

  it("comes to exactly 100 where the split does not divide", () => {
    // Three even seats are 33.33 each. Three 33s on screen come to 99, and a percentage that does
    // not add up is a figure the reader has to distrust.
    expect(pct([1, 1, 1])).toEqual([34, 33, 33]);
    expect(pct([1, 1, 1]).reduce((sum, n) => sum + n, 0)).toBe(100);
  });

  it("gives a seat that takes nothing a nothing, since zero is a real answer", () => {
    expect(pct([1, 0])).toEqual([100, 0]);
  });
});
