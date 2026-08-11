import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// A stack of pieces must never be sellable through its own row. It settles in tranches on the Drop Log,
// by COUNT; selling it here divides it as one pot of MONEY while the piece ledger is still counting the
// same drop in coupons, which is two settlements for one drop.
//
// The row gates its sale on `loot.status === "PENDING"`, and a piece drop is PENDING for ever, so it
// offered "Mark sold" on every coupon stack any party had ever dropped. There are no component tests in
// this repo and the condition is not reachable from a unit test, so this reads the source: the same
// approach as ledger-css.test.ts, and the alternative is nothing checking it at all.
//
// Whitespace is normalised first. Matching the source as written made this fail the moment Prettier
// re-wrapped a condition, which is a test that breaks on formatting rather than on behaviour.

const source = (...parts: string[]) =>
  readFileSync(join(__dirname, "..", ...parts), "utf8").replace(/\s+/g, " ");

const row = source("components", "loot-row.tsx");
// The rows themselves, wherever they are drawn from. LootList is the one component that renders
// them, on the party's page and in a Party View row alike, so this is the one place the flag can be
// dropped.
const list = source("components", "loot-list.tsx");

describe("a piece drop cannot be sold through its own row", () => {
  it("gates the sale form on it, alongside the status and the world", () => {
    expect(row).toContain('loot.status === "PENDING" && canSell && !pieces &&');
  });

  it("still offers Remove, so a mis-logged coupon stack can be corrected", () => {
    expect(row).toContain('loot.status === "PENDING" && canSell && pieces &&');
  });

  it("is told which rows those are, or the gate would never close", () => {
    // The prop defaults to undefined and every call type-checks without it, so tsc will not catch a
    // coupon group that forgets to pass it.
    expect(list).toContain("pieces={pieces}");
    expect(list).toContain("statusOf={pieceStatus} pieces");
  });

  it("splits the coupons out wherever the rows are drawn, so no caller can skip it", () => {
    // Party View draws the same pool in a row's panel. It reaches the rows through LootList, so the
    // split above applies to it too; passing `loot` to a group of its own would not.
    for (const caller of ["loot-pool.tsx", "party-card.tsx"]) {
      expect(source("components", caller)).toContain("<LootList");
      expect(source("components", caller)).not.toContain("<LootRow");
    }
  });
});
