import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

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
});
