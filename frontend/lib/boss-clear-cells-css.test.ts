import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");

const rule = (selector: string) => {
  const at = css.indexOf(`${selector} {`);
  expect(at, `${selector} is missing`).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf("}", at));
};

// The matrix colours the whole cell for its clear state. Two things about that are load-bearing and
// break SILENTLY rather than loudly, so they are pinned here.
describe("boss clear cells keep their state under the hover bands", () => {
  it("layers the hover band as an image so it cannot reset the state colour", () => {
    // The band and the cell state both want the cell's background. The band is drawn as a
    // background-image precisely so the two compose; written as the `background` shorthand it
    // resets background-color instead, and every state under the cursor turns plain. That is the
    // row and column you are actually looking at, so the failure hides exactly where it matters.
    const band = rule(".boss-table .boss-char-head.is-col-hover");

    expect(band).toMatch(/background-image:\s*linear-gradient/);
    expect(band).not.toMatch(/background:\s/);
  });

  it("sets the states with background-color so there is something for the band to sit on", () => {
    expect(rule(".boss-cell.is-cleared")).toMatch(/background-color:/);
    expect(rule(".boss-cell.is-pending")).toMatch(/background-color:/);

    // An unreported boss is not a boss that was not cleared. It gets no tint, or the blank becomes
    // a third colour people read as one of the other two.
    expect(rule(".boss-cell.is-unseen")).toMatch(/background-color:\s*transparent/);
  });
});

describe("the legend cannot drift from the table it describes", () => {
  it("draws its swatches from the same custom properties the cells read", () => {
    // Restating the tints here is the failure mode: the key goes on saying one thing after the
    // cells start saying another, and a key that disagrees with its table is worse than none.
    for (const [cell, key] of [
      [".boss-cell.is-cleared", ".boss-key.is-cleared"],
      [".boss-cell.is-pending", ".boss-key.is-pending"],
    ]) {
      const token = /background-color:\s*(var\(--cell-[a-z-]+\))/.exec(rule(cell))?.[1];
      expect(token, `${cell} should read a shared tint`).toBeTruthy();
      expect(rule(key)).toContain(token!);
    }
  });
});

// With the hue gone, brightness is the ONLY thing separating the three states, so the order of the
// three tints is the whole signal rather than a detail of it. Nothing here errors when it breaks:
// the table just quietly stops answering "what is left".
describe("the states stay ordered by brightness", () => {
  const mix = (name: string) =>
    Number(
      /var\(--ink-strong\)\s*(\d+)%/.exec(
        rule(".boss-matrix").match(`${name}:[^;]+`)?.[0] ?? "",
      )?.[1] ?? NaN,
    );

  it("makes still-to-do the brightest and done the quieter of the two", () => {
    // Backwards is the dangerous direction: done would shout and the work left would recede, which
    // is the complaint this whole thing started from.
    expect(mix("--cell-pending")).toBeGreaterThan(mix("--cell-cleared"));
  });

  it("dims the cleared tint further for a row with nothing left to do", () => {
    expect(mix("--cell-cleared-dim")).toBeLessThan(mix("--cell-cleared"));
    expect(rule(".boss-table tr.is-row-cleared .boss-cell.is-cleared")).toContain(
      "var(--cell-cleared-dim)",
    );
  });

  it("keeps a tick on the cleared cell at both brightnesses", () => {
    // The done and unreported fills are the two darkest and sit close together. The tick is what
    // separates them, so a rule that stopped setting a legible colour would collapse the two.
    expect(rule(".boss-cell.is-cleared")).toMatch(/color:\s*var\(--ink\)/);
    expect(rule(".boss-table tr.is-row-cleared .boss-cell.is-cleared")).toMatch(/color:\s*var\(/);
  });
});
