import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");

// Three rows fold, and they share one chevron class: .party-row in the by-character and by-boss
// lists, .boss-run in the by-party one, .droplog-row on a stacking drop in the Drop Log. The open
// state is a class on the row, so the rotation is a selector rather than anything the component can
// assert for itself, and a row left out of it still opens while its arrow keeps pointing at a
// closed panel.
describe("a folding row turns its chevron", () => {
  it("rotates it for every kind of row", () => {
    const at = css.indexOf(".party-row-chevron {");
    expect(at, ".party-row-chevron is missing").toBeGreaterThan(-1);
    const open = css.slice(at);
    expect(open).toMatch(/\.party-row\.is-open \.party-row-chevron/);
    expect(open).toMatch(/\.boss-run\.is-open \.party-row-chevron/);
    expect(open).toMatch(/\.droplog-row\.is-open \.party-row-chevron/);
  });
});
