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
  // The delays are the design, not tuning knobs: a prefetched route commits in single-figure ms,
  // so without them every navigation would flash the bar, the dim and the frame for a frame each.
  // Dropping one turns feedback into a flicker, which is why they are pinned here rather than left
  // to a comment.
  //
  // `<name> <duration> [easing] <delay>`, per comma-separated animation. Both times are read
  // rather than the first one found, because a delay silently read as a duration compares wrong.
  // Both units, because a 0s duration is spelled 0s and an ms-only match would skip it.
  const ms = (t: string) =>
    t.endsWith("ms") ? Number(t.slice(0, -2)) : Number(t.slice(0, -1)) * 1000;
  const delaysIn = (selector: string) => {
    const rule = new RegExp(
      `${selector.replace(/[.:()]/g, "\\$&")} \\{[^}]*animation:\\s*([^;]+);`,
    );
    const shorthand = rule.exec(css)?.[1];
    expect(shorthand, `no animation on ${selector}`).toBeDefined();
    return (shorthand ?? "").split(",").map((part) => {
      const times = part.match(/\d+m?s\b/g)?.map(ms);
      expect(times, `expected a duration and a delay in "${part.trim()}"`).toHaveLength(2);
      return times?.[1] as number;
    });
  };
  const oneDelay = (selector: string) => {
    const delays = delaysIn(selector);
    // The fade and the space it takes have to start at the same moment or the box opens on an
    // empty page, so a rule with several animations is only allowed one delay between them.
    expect(new Set(delays).size, `${selector} staggers its animations`).toBe(1);
    return delays[0] as number;
  };

  it("starts hidden, so nothing is drawn before the delay elapses", () => {
    // `forwards` on a 0s animation is what reveals it at the delay. Without the opacity:0 the bar
    // is simply always on, which is the flicker the delay exists to prevent.
    expect(/\.nav-pending \{[^}]*opacity:\s*0;/.test(css)).toBe(true);
  });

  it("waits the same before the bar and before the dim", () => {
    // Two rules, one moment. Staggering them reads as two separate things happening.
    expect(oneDelay(".nav-pending")).toBe(oneDelay("body:has(.nav-pending) main"));
    expect(oneDelay(".nav-pending")).toBeGreaterThanOrEqual(100);
  });

  it("keeps the delay on the sweep too", () => {
    expect(oneDelay(".nav-pending::before")).toBe(oneDelay(".nav-pending"));
  });

  // Three waits, longest last, and the order is the point. The bar answers "the click registered"
  // and has to be quick. The frame is the page arriving, and drawing half of it early only buys a
  // second update moments later: measured on the production build at a 300ms load, the frame
  // appeared at 162ms and was replaced at 328ms, having spent 116 of its 166 visible ms still
  // fading in. The note is the only part of that frame the page throws away rather than fills in,
  // so it waits longest of all.
  it("waits longer before the frame than before the bar", () => {
    expect(oneDelay(".page-waiting")).toBeGreaterThan(oneDelay(".nav-pending"));
  });

  it("waits longer again before saying it is still loading", () => {
    expect(oneDelay(".waiting-note")).toBeGreaterThan(oneDelay(".page-waiting"));
  });

  it("holds the skeleton hidden through the delay", () => {
    // The backwards half of `both` is the whole mechanism. With `forwards` alone the skeleton is
    // simply always on, which is the flicker the delay exists to prevent.
    expect(/\.page-waiting \{[^}]*animation:[^;]*\bboth\b/.test(css)).toBe(true);
    expect(/\.waiting-note \{[^}]*animation:[^;]*\bboth\b/.test(css)).toBe(true);
    expect(/@keyframes page-waiting-in \{\s*from \{\s*opacity:\s*0;/.test(css)).toBe(true);
  });

  it("keeps every delay under reduced motion, and drops only the fades", () => {
    // The delay is what stops the flicker; the fade is the part reduced motion asks to lose. A
    // media block that quietly drops the delay with it puts the flicker back for those users only,
    // where nobody would see it.
    const reduced = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/.exec(css)?.[1];
    expect(reduced, "no reduced-motion block").toBeDefined();
    for (const selector of [".page-waiting", ".waiting-note"]) {
      const shorthand = new RegExp(`\\${selector} \\{[^}]*animation:\\s*([^;]+);`).exec(
        reduced ?? "",
      )?.[1];
      expect(shorthand, `${selector} is not restated under reduced motion`).toBeDefined();
      for (const part of (shorthand ?? "").split(",")) {
        const times = part.match(/\d+m?s\b/g)?.map(ms);
        expect(times?.[0], `${selector} still fades under reduced motion`).toBe(0);
        expect(times?.[1]).toBe(oneDelay(selector));
      }
    }
  });
});

describe("every wait wears the class", () => {
  const root = join(__dirname, "..");
  const read = (f: string) => readFileSync(join(root, f), "utf8");

  // The class is the whole mechanism, so a <main> that spells itself out silently opts back into
  // the flash: the page still works, it just flickers. These are written by copying a neighbour,
  // so this asserts against the tree rather than trusting the copy.
  const boundaries = globSync("app/**/loading.tsx", { cwd: root });

  it("found the boundaries", () => expect(boundaries.length).toBeGreaterThanOrEqual(12));

  it.each(boundaries)("%s renders RouteLoading, not a bare main", (file) => {
    expect(read(file)).toContain("RouteLoading");
    expect(read(file)).not.toContain("<main");
  });

  // A page that fetches its own data does the waiting itself, and that is where the measured
  // flash actually came from: the boundary never renders at all for a route whose payload was
  // already prefetched.
  const pages = globSync("app/**/page.tsx", { cwd: root }).filter((f) =>
    read(f).includes('state === "loading"'),
  );

  it("found the pages that wait", () => expect(pages.length).toBeGreaterThanOrEqual(10));

  it.each(pages)("%s marks its main while it waits", (file) => {
    expect(read(file)).toContain("PAGE_WAITING");
    expect(read(file), "a bare main opts out of the delay").not.toContain(
      '<main className="page">',
    );
  });

  // The note carries its own, longer delay, and spelling the line out by hand drops it: the page
  // then says it is loading at the same moment the frame appears, and takes it back a few frames
  // later. Every one of these was written by copying a neighbour, so assert against the tree.
  const everything = [...boundaries, ...globSync("app/**/page.tsx", { cwd: root })];

  it.each(everything)("%s says it is loading through WaitingNote", (file) => {
    const src = read(file);
    if (!/Loading\.\.\./.test(src)) return;
    expect(src, "a hand-written loading line has no delay").toContain("WaitingNote");
    expect(src).not.toMatch(/<p[^>]*>\s*Loading\.\.\./);
  });
});
