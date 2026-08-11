import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The Sale Ledger draws one card per HOLDER, and the page exists to have a sale typed into the right
// one. Every card used to be titled "Vestige of Erion", which is true of all of them and so told them
// apart not at all: two piles read as one card drawn twice, and the only thing that distinguished
// them was the smallest text on them.
//
// A source test rather than a unit one, because there is nothing to call: the title is a literal in
// the header, and the way it goes wrong is somebody writing the coupon's name back into it.

const source = readFileSync(join(__dirname, "..", "components", "piece-ledger.tsx"), "utf8");

/** The card's title element, which is what picks the pile a sale is entered against. */
const title = source.match(/<span className="loot-name">([\s\S]*?)<\/span>/);

describe("the ledger card's title", () => {
  it("names the holder, since that is the one thing that differs between cards", () => {
    expect(title).not.toBeNull();
    expect(title![1]).toContain("holderName");
  });

  it("does not name the coupon, which is the same on every card", () => {
    expect(title![1]).not.toContain("Vestige");
  });

  it("still names the coupon to a screen reader, which the icon is all that is left to do it", () => {
    expect(source).toMatch(/<img className="loot-icon"[^>]*alt="Vestige of Erion"/);
  });
});
