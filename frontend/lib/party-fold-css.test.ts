import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");

// Rows fold in four places, and they share one chevron class: .party-row in all three party
// groupings, .droplog-row on a stacking drop in the Drop Log, .droplog-character on one character's
// share of that drop, a table row in Run Order. The open state is a class on the row, so the
// rotation is a selector rather than anything the component can assert for itself, and a row left
// out of it still opens while its arrow keeps pointing at a closed panel.
describe("a folding row turns its chevron", () => {
  it("rotates it for every kind of row", () => {
    const at = css.indexOf(".party-row-chevron {");
    expect(at, ".party-row-chevron is missing").toBeGreaterThan(-1);
    const open = css.slice(at);
    expect(open).toMatch(/\.party-row\.is-open \.party-row-chevron/);
    expect(open).toMatch(/\.droplog-row\.is-open > \.droplog-row-head \.party-row-chevron/);
    expect(open).toMatch(
      /\.droplog-character\.is-open > \.droplog-character-head \.party-row-chevron/,
    );
    expect(open).toMatch(/\.run-table tr\.is-open \.party-row-chevron/);
  });

  // The Drop Log now nests one fold inside another, so a descendant selector on the outer row
  // reaches the inner rows' chevrons: opening a drop turned every closed character arrow with it.
  it("turns only its own, where one fold sits inside another", () => {
    const at = css.indexOf(".party-row-chevron {");
    expect(css.slice(at)).not.toMatch(/\.droplog-row\.is-open \.party-row-chevron/);
  });
});
