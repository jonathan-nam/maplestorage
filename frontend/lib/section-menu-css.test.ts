import { globSync, readFileSync } from "node:fs";
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

  // A waiting page is the same wait, and it broke the same way the bar would have without its
  // delay. Measured on the production build: the click committed 12ms in, so /bosses drew its
  // 980px matrix skeleton for one frame between the outgoing 174px page and the incoming 147px
  // one. It lands just AFTER the bar's wait rather than during it, which is why the bar's own
  // delay never covered it.
  it("waits the same before the skeleton as before the bar", () => {
    // `<name> <duration> [easing] <delay>`: duration first, delay second, per comma-separated
    // animation. delayIn() takes the first time it finds, which here is a duration, so every
    // animation on the rule is read on its own and they must agree. The fade and the space it
    // takes have to start at the same moment or the box opens on an empty page.
    const shorthand = /\.page-waiting \{[^}]*animation:\s*([^;]+);/.exec(css)?.[1];
    // Both units, because a 0s duration is spelled 0s and an ms-only match silently reads the
    // delay as the duration and finds nothing to compare.
    const ms = (t: string) =>
      t.endsWith("ms") ? Number(t.slice(0, -2)) : Number(t.slice(0, -1)) * 1000;
    const delays = shorthand?.split(",").map((part) => {
      const times = part.match(/\d+m?s\b/g)?.map(ms);
      expect(times, `expected a duration and a delay in "${part.trim()}"`).toHaveLength(2);
      return times?.[1];
    });
    expect(delays?.length).toBeGreaterThanOrEqual(2);
    for (const delay of delays ?? []) expect(delay).toBe(delayIn(".nav-pending"));
  });

  it("holds the skeleton hidden through the delay", () => {
    // The backwards half of `both` is the whole mechanism. With `forwards` alone the skeleton is
    // simply always on, which is the flicker the delay exists to prevent.
    expect(/\.page-waiting \{[^}]*animation:[^;]*\bboth\b/.test(css)).toBe(true);
    expect(/@keyframes page-waiting-in \{\s*from \{\s*opacity:\s*0;/.test(css)).toBe(true);
  });

  // The other end of the same transition. The delay above covers the wait; nothing covered the
  // arrival, so a page swapped one line of "Loading..." for its whole self between two frames.
  it("eases the arriving content in rather than swapping it on", () => {
    expect(/\.page-ready \{[^}]*animation:\s*page-ready-in\s+\d+m?s/.test(css)).toBe(true);
    expect(/@keyframes page-ready-in \{\s*from \{\s*opacity:\s*0;/.test(css)).toBe(true);
  });

  // No delay, unlike the wait. This one starts the moment the content exists: a delay here is a
  // gap with the "Loading..." already gone and nothing yet in its place.
  it("starts the arrival immediately", () => {
    const shorthand = /\.page-ready \{[^}]*animation:\s*([^;]+);/.exec(css)?.[1];
    expect(shorthand?.match(/\d+m?s\b/g)).toHaveLength(1);
  });
});

describe("every wait wears the class", () => {
  const root = join(__dirname, "..");
  const read = (f: string) => readFileSync(join(root, f), "utf8");

  // The class is the whole mechanism, so a <main> that spells itself out silently opts back into
  // the flash: the page still works, it just flickers. These are written by copying a neighbour,
  // so this asserts against the tree rather than trusting the copy.
  const boundaries = globSync("app/**/loading.tsx", { cwd: root });

  // A floor, not a count: it exists so a glob that matches nothing passes silently. It moves when
  // a route is added or retired, which is what deleting the Wallet did.
  it("found the boundaries", () => expect(boundaries.length).toBeGreaterThanOrEqual(11));

  it.each(boundaries)("%s renders RouteLoading, not a bare main", (file) => {
    expect(read(file)).toContain("RouteLoading");
    expect(read(file)).not.toContain("<main");
  });

  // A page that fetches its own data does the waiting itself, and that is where the measured
  // flash actually came from: the boundary never renders at all for a route whose payload was
  // already prefetched.
  //
  // Matched on the wait itself, not on the class: a page that forgot the class is exactly what
  // this is for. Characters spells its wait `!loaded` rather than with a LoadState, which is how
  // it sat on a bare `<main className="page">` for as long as this test only looked for the one
  // spelling.
  const pages = globSync("app/**/page.tsx", { cwd: root }).filter((f) =>
    /state === "loading"|!loaded && !failed/.test(read(f)),
  );

  it("found the pages that wait", () => expect(pages.length).toBeGreaterThanOrEqual(10));

  it.each(pages)("%s marks its main while it waits", (file) => {
    expect(read(file)).toContain("PAGE_WAITING");
    expect(read(file), "a bare main opts out of the delay").not.toContain(
      '<main className="page">',
    );
  });

  // Run Order alone. Its page is not one block that arrives: the roster, the clock and the plan
  // are drawn off derived state and come and go as the source is toggled, so a fade on them would
  // fire on a click rather than on the load. What its own load state gates is an empty-list line
  // and a checkbox.
  const ARRIVES_IN_PIECES = ["app/bosses/order/page.tsx"];

  it.each(pages.filter((f) => !ARRIVES_IN_PIECES.includes(f)))(
    "%s eases its content in when it arrives",
    (file) => {
      expect(read(file)).toContain("PAGE_READY");
    },
  );
});
