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

describe("a finished row goes quiet", () => {
  it("dims the cleared tint only for a row with nothing left to do", () => {
    // The lit/dim split is the whole at-a-glance signal: a row still holding an amber cell keeps
    // full colour. If the dim tint stopped being weaker than the normal one the two would read the
    // same and the signal would be gone, with nothing erroring.
    const pct = (declaration: string) =>
      Number(/var\(--good\)\s*(\d+)%/.exec(declaration)?.[1] ?? NaN);

    const lit = pct(rule(".boss-matrix").match(/--cell-cleared:[^;]+/)?.[0] ?? "");
    const dim = pct(rule(".boss-matrix").match(/--cell-cleared-dim:[^;]+/)?.[0] ?? "");

    expect(dim).toBeLessThan(lit);
    expect(rule(".boss-table tr.is-row-cleared .boss-cell.is-cleared")).toContain(
      "var(--cell-cleared-dim)",
    );
  });
});
