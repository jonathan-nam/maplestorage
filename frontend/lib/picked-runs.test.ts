import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// A drag through the run grid picks whole rows, and Ctrl+C copies those rows. Two halves of that
// hold nowhere a unit test can reach: which rows are drawn as picked (CSS), and how the rows are
// found (a `data-run` attribute read back out of the DOM). Both fail SILENTLY. A row that stops
// carrying the attribute picks nothing, and Ctrl+C quietly falls back to the browser's own copy of
// a table row, which is the portrait, the length and the pool count run together.
//
// So this reads the source, the way event-target-guard.test.ts does.

const root = join(__dirname, "..");
const css = readFileSync(join(root, "app", "globals.css"), "utf8");
const component = readFileSync(join(root, "components", "run-plan.tsx"), "utf8");

const HOVER = ".run-table tbody tr:hover,";
const PICKED = ".run-table tbody tr.is-picked,";

describe("a picked run row", () => {
  it("is painted after the hover band it ties with", () => {
    // Two classes and two elements each, so neither selector outweighs the other and the later
    // rule is the one that wins. Picked has to win: it is the answer to something you did, and
    // the row under the pointer is not.
    const hover = css.indexOf(HOVER);
    const picked = css.indexOf(PICKED);
    expect(hover, "the hover band is missing").toBeGreaterThan(-1);
    expect(picked, "the picked band is missing").toBeGreaterThan(-1);
    expect(picked).toBeGreaterThan(hover);
  });

  it("paints the cells as well as the row", () => {
    // The column hover paints a background on the cell itself, which would sit on top of a band
    // drawn only on the row and leave a picked row with an unpicked column through it.
    expect(css).toContain(".run-table tbody tr.is-picked .run-cell {");
  });

  it("changes nothing that has a size", () => {
    // The band is drawn while the mouse is still down. Anything that resizes a row mid-drag moves
    // the rows under the cursor and the selection follows them.
    const at = css.indexOf(PICKED);
    const body = css.slice(css.indexOf("{", at) + 1, css.indexOf("}", at));
    const properties = body
      .split(";")
      .map((line) => (line.split(":")[0] ?? "").trim())
      .filter((name) => name.length > 0);
    expect(properties).toEqual(["background"]);
  });
});

describe("the rows a drag reads back", () => {
  it("carries the attribute pickedRuns queries for", () => {
    expect(component).toContain("data-run={planned.run.id}");
    expect(component).toContain('querySelectorAll<HTMLElement>("tr[data-run]")');
  });

  it("copies nothing of its own when no row was picked", () => {
    // preventDefault before the empty check would turn a drag inside one cell, and every copy
    // elsewhere on the page, into a copy of nothing.
    const empty = component.indexOf("if (rows.size === 0");
    const prevented = component.indexOf("e.preventDefault()");
    expect(empty).toBeGreaterThan(-1);
    expect(prevented).toBeGreaterThan(empty);
  });
});
