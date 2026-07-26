import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");

const rule = (selector: string) => {
  const at = css.indexOf(`${selector} {`);
  expect(at, `${selector} is missing`).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf("}", at));
};

// The matrix's three states used to be a green tick, a grey middot and a blank, which differed
// only in colour and weight. Across 16 bosses that reads as one field of texture, and finding what
// is left means hunting for the absence of a tick. The fix was to make them differ in SHAPE, so
// these pin the shape rather than the palette: colours are free to move, "filled vs hollow vs
// nothing" is not.
describe("boss clear marks stay apart without colour", () => {
  it("fills the cleared mark more than the pending one, so done reads as filled in", () => {
    const fill = (selector: string) =>
      Number(/background:\s*color-mix\(in srgb, var\(--\w+\) (\d+)%/.exec(rule(selector))?.[1]);

    expect(fill(".boss-cell-mark.is-cleared")).toBeGreaterThan(fill(".boss-cell-mark.is-pending"));
  });

  it("gives both a border and the unreported state none", () => {
    expect(rule(".boss-cell-mark.is-cleared")).toMatch(/border-color:/);
    expect(rule(".boss-cell-mark.is-pending")).toMatch(/border-color:/);

    // An unreported boss is not a boss that was not cleared. It gets no slot, or the blank turns
    // into a third mark people read as one of the other two.
    const unseen = rule(".boss-cell-mark.is-unseen");
    expect(unseen).toMatch(/border-color:\s*transparent/);
    expect(unseen).toMatch(/background:\s*none/);
  });

  it("keeps the mark an inner block so the column hover cannot paint over the state", () => {
    // .is-col-hover sets a background on .boss-cell itself and wins on specificity. A state drawn
    // as the cell's own background would vanish under the cursor, which is where you are looking.
    expect(rule(".boss-cell-mark")).toMatch(/display:\s*inline-flex/);
    expect(css).not.toMatch(/\.boss-cell\.is-(cleared|pending)\s*\{/);
  });
});
