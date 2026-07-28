import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");

const rule = (selector: string) => {
  const at = css.indexOf(`${selector} {`);
  expect(at, `${selector} is missing`).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf("}", at));
};

// The matrix draws its four states as marks with no fills, so three of them are glyphs and the
// fourth is the gap between them. That only works while the glyphs are visible: make the dash
// transparent and "no capture" becomes an empty cell, which is "not cleared" as far as anyone
// reading the table can tell. Nothing errors when it happens, the table just starts answering a
// question it was not asked, which is the failure this project exists to prevent.
describe("boss clear marks stay visible", () => {
  it("gives the three marked states a colour and leaves only not-cleared blank", () => {
    expect(rule(".boss-cell.is-cleared")).toMatch(/color:\s*var\(--ink\)/);
    expect(rule(".boss-cell.is-unseen")).toMatch(/color:\s*var\(--muted-2\)/);
    expect(rule(".boss-cell.is-skipped")).toMatch(/color:\s*var\(--muted-2\)/);
    expect(rule(".boss-cell.is-pending")).toMatch(/color:\s*transparent/);
  });

  it("lets the mark's colour through the button the live view wraps it in", () => {
    // The three colours above are set on the cell, and a button does not inherit colour on its
    // own: the UA sets its own. Drop `color: inherit` and every mark on the editable matrix goes
    // to the button's default, which takes the dash and the tick to the same shade and collapses
    // "no capture" into "not cleared" on the one view where they can be told apart.
    expect(rule(".boss-mark")).toMatch(/color:\s*inherit/);
  });

  it("holds the not-cleared cell open, since its mark is the absence of one", () => {
    // The button's only visible child is the glyph, and not-cleared has none, so without a height
    // the cell collapses to its padding and that row's gap stops lining up with the marks it is
    // read against.
    expect(rule(".boss-mark")).toMatch(/min-height:/);
  });

  it("does not fill the cells, so the state is the mark and not the background", () => {
    // Colouring the cells was tried twice and taken back out: the fill landed in the same channel
    // as the row striping below, and read as shading rather than as a state.
    for (const state of ["is-cleared", "is-pending", "is-unseen", "is-skipped"]) {
      expect(rule(`.boss-cell.${state}`)).not.toMatch(/background/);
    }
  });
});
