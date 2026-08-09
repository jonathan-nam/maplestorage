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

describe("the pending mark on a clicked entry", () => {
  it("comes after .active, which it usually has to beat", () => {
    // Same specificity, and the entry being navigated TO is the one about to become active. An
    // earlier rule loses to it on exactly the click the mark exists for.
    const activeRule = css.indexOf(".section-menu-panel a.active {");
    const pendingRule = css.indexOf(".section-menu-panel a.is-pending {");
    expect(activeRule).toBeGreaterThan(-1);
    expect(pendingRule).toBeGreaterThan(activeRule);
  });

  it("waits before drawing anything, in both motion settings", () => {
    // The delay is the design, not a tuning knob: a prefetched route commits in about 10ms, so
    // without it every navigation would flash the mark for a frame. Dropping it silently turns
    // the feedback into a flicker, which is why it is pinned here rather than left to a comment.
    const delays = [
      ...css.matchAll(/\.section-menu-panel a\.is-pending \{[^}]*animation:[^;]*?(\d+)ms/g),
    ].map((m) => Number(m[1]));
    expect(delays).toHaveLength(2); // the pulse, and the reduced-motion still
    for (const delay of delays) expect(delay).toBeGreaterThanOrEqual(100);
  });
});
