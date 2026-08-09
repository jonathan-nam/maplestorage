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

describe("the wait for a page that has been asked for", () => {
  // The delay is the design, not a tuning knob: a prefetched route commits in single-figure ms, so
  // without it every navigation would flash the bar and dim the page for a frame. Dropping it
  // turns feedback into a flicker, which is why it is pinned here rather than left to a comment.
  const delayIn = (selector: string) => {
    const rule = new RegExp(
      `${selector.replace(/[.:()]/g, "\\$&")} \\{[^}]*animation:[^;]*?(\\d+)ms`,
    );
    const found = rule.exec(css);
    expect(found, `no delayed animation on ${selector}`).not.toBeNull();
    return Number(found?.[1]);
  };

  it("starts hidden, so nothing is drawn before the delay elapses", () => {
    // `forwards` on a 0s animation is what reveals it at the delay. Without the opacity:0 the bar
    // is simply always on, which is the flicker the delay exists to prevent.
    expect(/\.nav-pending \{[^}]*opacity:\s*0;/.test(css)).toBe(true);
  });

  it("waits the same before the bar and before the dim", () => {
    // Two rules, one moment. Staggering them reads as two separate things happening.
    expect(delayIn(".nav-pending")).toBe(delayIn("body:has(.nav-pending) main"));
    expect(delayIn(".nav-pending")).toBeGreaterThanOrEqual(100);
  });

  it("keeps the delay on the sweep too", () => {
    expect(delayIn(".nav-pending::before")).toBe(delayIn(".nav-pending"));
  });
});
