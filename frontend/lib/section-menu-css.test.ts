import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");

// Cascade order that is load-bearing, and whose breakage is invisible rather than loud. A rule
// that loses to a later one at equal specificity does not error, it just quietly stops applying.
// The Bossing group shipped unindented once for exactly this reason.
describe("section menu indentation survives the cascade", () => {
  it("indents nested entries after the rule that sets the flush padding", () => {
    // `.section-menu-panel a` sets `padding` shorthand. At equal specificity the later rule wins,
    // so the indent must come after it or it is reset to flush and the nesting disappears.
    const flush = css.indexOf(".section-menu-panel a {");
    const indent = css.indexOf(".section-menu-group a {");
    expect(flush).toBeGreaterThan(-1);
    expect(indent).toBeGreaterThan(flush);
  });

  it("indents further than the flush entries actually are", () => {
    const flushPadding = /\.section-menu-panel a \{[^}]*padding:\s*\d+px\s+(\d+)px/.exec(css);
    const indented = /\.section-menu-group a \{[^}]*padding-left:\s*(\d+)px/.exec(css);
    expect(Number(indented?.[1])).toBeGreaterThan(Number(flushPadding?.[1]));
  });
});
