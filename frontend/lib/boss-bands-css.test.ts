import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");

const rule = (selector: string) => {
  const at = css.indexOf(`\n${selector} {`);
  expect(at, `no rule for ${selector}`).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf("}", at));
};

// Shared by both head cells; the corner one adds to the bottom of it. See below.
const BASE_CELL_PADDING = 6;

/**
 * The band figures sit in the corner of the column heads, and they are meant to read as level with
 * the character art beside them. That cell is a sprite with an IGN under it, so centring in the
 * whole of it lands them half a line low and hard against the rule at the bottom of the row, which
 * is what this replaced. The extra bottom padding is that line, lifting the centre onto the art.
 *
 * Measured in Chromium against the real stylesheet: sprite centre 63.0, bands centre 62.8.
 * Nothing in a browser checks it and being a few px out is not a bug anyone files, so the two
 * things that would undo it are pinned instead: the alignment, and the padding that corrects it.
 */
describe("the band figures in the corner cell", () => {
  it("centres rather than sitting on the bottom rule", () => {
    expect(rule(".boss-col-head")).toMatch(/vertical-align:\s*middle/);
  });

  it("pads the bottom past the shared cell padding, to lift the centre onto the sprite", () => {
    const found = rule(".boss-col-head").match(/padding-bottom:\s*(\d+)px/);
    expect(found, ".boss-col-head has no padding-bottom to correct the centring").not.toBeNull();
    expect(Number((found as RegExpMatchArray)[1])).toBeGreaterThan(BASE_CELL_PADDING);
  });
});
