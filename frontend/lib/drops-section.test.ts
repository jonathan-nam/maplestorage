import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// What FELL is headed as a drop, and the standing split is a block of its own.
//
// A Party View row's panel used to head the week's coupons with the config's own title, inside the
// config's frame: "Vestige of Erion Config" over a stack of 180 that had already dropped. Read as a
// setting rather than as the week's biggest drop, which is the report this pins ("make it a bit more
// obvious that the Vestiges are part of the drops for the week").
//
// Source tests, because there is no component render harness here: the same approach as
// piece-row-guard.test.ts, and the alternative is nothing checking it at all. Whitespace is
// normalised so Prettier re-wrapping a line cannot fail this.

const source = (...parts: string[]) =>
  readFileSync(join(__dirname, "..", ...parts), "utf8").replace(/\s+/g, " ");

const list = source("components", "loot-list.tsx");
const page = source("app", "bosses", "parties", "page.tsx");

describe("the week's coupons are drops, not configuration", () => {
  it("heads them with what they are, whether or not the boxes are on screen", () => {
    expect(list).toContain('const couponTitle = headed ? "Coupons" : stacks ? "Drops" : null');
  });

  it("frames the split alone, with everything that fell outside it", () => {
    // The frame opens immediately before the split's heading, so nothing that fell can be in it.
    expect(list).toContain(
      '<div className="loot-config-card"> <h3 className="loot-group-title is-config">' +
        "{stacks.entitledTitle}</h3> <StackAssign",
    );
    // Once only. A second one is the group of rows building a frame of its own again, which is the
    // arrangement this replaced.
    expect(list.match(/loot-config-card/g)).toHaveLength(1);
    expect(source("app", "globals.css")).toContain(".loot-config-card {");
  });

  it("keeps the split on screen in a week nothing fell in", () => {
    // Off the catalog, so it can be agreed before the boss is ever run. The group of rows returns
    // null when empty, which is why the split is drawn by LootList and not by the group.
    expect(list).toContain("if (rows.length === 0) return null;");
  });

  it("names the split by what it says, and heads the rows with nothing", () => {
    expect(page).toContain('entitledTitle: "Entitled each week"');
    // No heading is handed down over the rows. The old one named our word for the row, twice over:
    // a config, of a coupon.
    expect(page).not.toContain('title: "Vestige');
  });
});
