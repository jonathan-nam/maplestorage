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
// component tests in this repo, so the row's seed is read off the source, as piece-row-guard does.

const source = (...parts: string[]) =>
  readFileSync(join(__dirname, "..", ...parts), "utf8").replace(/\s+/g, " ");

const row = source("components", "loot-row.tsx");

describe("the sale form's share boxes", () => {
  it("open on one share each", () => {
    expect(row).toContain('const shareOf = (memberId: string) => shares[memberId] ?? "1";');
  });

  it("read no stored ratio, standing or pinned", () => {
    expect(row).not.toContain("sharesThatWeek");
    expect(row).not.toContain("?.shares");
  });

  it("are still typeable, so an uneven split is one box away", () => {
    expect(row).toContain("aria-label={`Shares for ${m.name}`}");
  });
});
