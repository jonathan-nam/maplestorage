import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");

const num = (pattern: RegExp) => {
  const found = css.match(pattern);
  expect(found, `no match for ${pattern}`).not.toBeNull();
  return Number((found as RegExpMatchArray)[1]);
};

/**
 * The gutter's breakpoint is arithmetic on three other numbers, and nothing in the browser checks
 * it. Widen the page or the panel without moving the query and the panel is positioned into a
 * gutter too narrow to hold it: it lands over the page's own text, or off the right of the window
 * where nobody sees the countdown at all. Both fail silently at exactly one range of widths.
 */
describe("the page gutter", () => {
  it("only leaves the flow at a width where it actually fits beside the page", () => {
    const measure = num(/--measure:\s*(\d+)px/);
    const breakpoint = num(/@media \(min-width:\s*(\d+)px\)\s*\{\s*\.page-gutter\b/);
    const gap = num(/left:\s*calc\(.*\+\s*(\d+)px\);/);
    const width = num(/@media \(min-width:[\s\S]*?\.page-gutter \{[\s\S]*?width:\s*(\d+)px/);

    expect(breakpoint).toBeGreaterThanOrEqual(measure + 2 * (width + gap));
  });

  // Narrow, it has to fall back into the flow rather than vanish: what it holds is a countdown to
  // the reset and how much of the week is cleared, neither of which the page says anywhere else.
  it("is a plain block until then", () => {
    const base = css.slice(
      css.indexOf(".page-gutter {"),
      css.indexOf("@media (min-width: 1282px)"),
    );
    expect(base).not.toMatch(/position:\s*(fixed|absolute)/);
    expect(base).not.toMatch(/display:\s*none/);
  });
});
