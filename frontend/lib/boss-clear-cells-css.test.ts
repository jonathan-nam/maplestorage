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

describe("still-to-do stays out of the greys", () => {
  const tint = (name: string) => rule(".boss-matrix").match(`${name}:[^;]+`)?.[0] ?? "";

  it("gives still-to-do a hue rather than another grey", () => {
    // This table already spends grey on the row striping, so a grey fill lands in a channel that
    // is taken and reads as shading rather than as a state. That shipped once and was reported as
    // exactly that, and nothing about it errors: the cell is still drawn, it just stops meaning
    // anything. The same reasoning is why the hover band is a tint and not a lighter grey.
    expect(tint("--cell-pending")).toContain("var(--todo)");
    expect(tint("--cell-pending")).not.toContain("var(--ink-strong)");
  });

  it("keeps --todo off the hover band's hue, so a hovered column is not a state", () => {
    const todo = /--todo:\s*(#[0-9a-f]{6})/i.exec(css)?.[1];
    const accent = /--accent:\s*(#[0-9a-f]{6})/i.exec(css)?.[1];

    expect(todo).toBeTruthy();
    expect(todo).not.toBe(accent);
  });

  it("leaves done and unreported as greys, so only the work left is coloured", () => {
    // Done recedes and an unreported boss has nothing to say. Colouring either one back up turns
    // the table into a traffic light again.
    expect(tint("--cell-cleared")).toContain("var(--ink-strong)");
    expect(tint("--cell-cleared-dim")).toContain("var(--ink-strong)");
  });

  it("dims the cleared tint further for a row with nothing left to do", () => {
    const pct = (name: string) => Number(/(\d+)%/.exec(tint(name))?.[1] ?? NaN);

    expect(pct("--cell-cleared-dim")).toBeLessThan(pct("--cell-cleared"));
    expect(rule(".boss-table tr.is-row-cleared .boss-cell.is-cleared")).toContain(
      "var(--cell-cleared-dim)",
    );
  });

  it("gives the two unfilled states a legible mark each", () => {
    // Done and unreported are both quiet, so each says its own name: a tick and a dash. Leaving
    // the blank to mean "no capture" on its own is what made the two hard to tell apart.
    expect(rule(".boss-cell.is-cleared")).toMatch(/color:\s*var\(--ink\)/);
    expect(rule(".boss-cell.is-unseen")).toMatch(/color:\s*var\(/);
    expect(rule(".boss-table tr.is-row-cleared .boss-cell.is-cleared")).toMatch(/color:\s*var\(/);
  });
});
