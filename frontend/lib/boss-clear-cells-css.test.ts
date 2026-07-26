import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");

const rule = (selector: string) => {
  const at = css.indexOf(`${selector} {`);
  expect(at, `${selector} is missing`).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf("}", at));
};

// The matrix draws its three states as marks with no fills, so two of them are glyphs and the
// third is the gap between them. That only works while the glyphs are visible: make the dash
// transparent and "no capture" becomes an empty cell, which is "not cleared" as far as anyone
// reading the table can tell. Nothing errors when it happens, the table just starts answering a
// question it was not asked, which is the failure this project exists to prevent.
describe("boss clear marks stay visible", () => {
  it("gives the two marked states a colour and leaves only still-to-do blank", () => {
    expect(rule(".boss-cell.is-cleared")).toMatch(/color:\s*var\(--ink\)/);
    expect(rule(".boss-cell.is-unseen")).toMatch(/color:\s*var\(--muted-2\)/);
    expect(rule(".boss-cell.is-pending")).toMatch(/color:\s*transparent/);
  });

  it("does not fill the cells, so the state is the mark and not the background", () => {
    // Colouring the cells was tried twice and taken back out: the fill landed in the same channel
    // as the row striping below, and read as shading rather than as a state.
    for (const state of ["is-cleared", "is-pending", "is-unseen"]) {
      expect(rule(`.boss-cell.${state}`)).not.toMatch(/background/);
    }
  });
});
