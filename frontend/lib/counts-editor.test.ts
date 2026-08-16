import { describe, expect, it } from "vitest";
import { MAX_COUNT, changedCounts, openingValues, parseCount, unreadable } from "./counts-editor";
import type { CountRow } from "./counts-editor";

const row = (id: string, stored: number): CountRow => ({
  tokenCatalogId: id,
  name: id,
  iconUrl: null,
  itemGroup: "Eternal Pieces",
  stored,
});

describe("reading a typed count", () => {
  it("takes a whole number, including zero", () => {
    expect(parseCount("14")).toBe(14);
    // Zero is a real answer: the item you have just spent. It CLEARS the row on the server.
    expect(parseCount("0")).toBe(0);
    expect(parseCount("  7 ")).toBe(7);
  });

  it("refuses a blank, rather than reading it as zero", () => {
    // The distinction the whole editor rests on. A blank box is one nobody has touched, and reading
    // it as zero would clear every item on the screen the first time somebody saved after editing
    // one of them.
    expect(parseCount("")).toBeNull();
    expect(parseCount("   ")).toBeNull();
  });

  it("refuses anything that is not a count", () => {
    // "1O" is the letter O, which is the typo this repo has already been bitten by on a quantity.
    expect(parseCount("1O")).toBeNull();
    expect(parseCount("-2")).toBeNull();
    expect(parseCount("1.5")).toBeNull();
    expect(parseCount("1e3")).toBeNull();
    expect(parseCount(String(MAX_COUNT + 1))).toBeNull();
  });
});

describe("what gets written", () => {
  const rows = [row("a", 5), row("b", 0), row("c", 12)];

  it("opens the boxes on what is stored", () => {
    expect(openingValues(rows)).toEqual({ a: "5", b: "0", c: "12" });
  });

  it("writes only the rows that actually differ", () => {
    // Every write stamps capturedAt, so re-sending an untouched count would age-stamp the whole
    // inventory as freshly answered for and lose which figures are current.
    const typed = { a: "5", b: "3", c: "12" };
    expect(changedCounts(rows, typed)).toEqual([{ tokenCatalogId: "b", quantity: 3 }]);
  });

  it("writes a zero, because clearing an item is a change like any other", () => {
    expect(changedCounts(rows, { a: "0", b: "0", c: "12" })).toEqual([
      { tokenCatalogId: "a", quantity: 0 },
    ]);
  });

  it("writes nothing when nothing was touched", () => {
    expect(changedCounts(rows, openingValues(rows))).toEqual([]);
  });

  it("skips an unreadable box rather than guessing at it", () => {
    const typed = { a: "5", b: "oops", c: "13" };
    expect(changedCounts(rows, typed)).toEqual([{ tokenCatalogId: "c", quantity: 13 }]);
    // And says which one, so Save can refuse instead of dropping it in silence.
    expect(unreadable(typed)).toEqual(["b"]);
  });

  it("names every unreadable box, not just the first", () => {
    expect(unreadable({ a: "", b: "x", c: "4" })).toEqual(["a", "b"]);
  });

  it("ignores an item the editor is not showing", () => {
    // A stale typed map from a previous character must not write counts onto this one.
    expect(changedCounts([row("a", 5)], { a: "5", z: "99" })).toEqual([]);
  });
});
