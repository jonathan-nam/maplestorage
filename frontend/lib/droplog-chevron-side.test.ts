import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const read = (...parts: string[]) => readFileSync(join(root, ...parts), "utf8");

const page = read("app", "bosses", "drops", "page.tsx");
const settled = read("components", "settled-view.tsx");
const skeleton = read("components", "drop-log-skeleton.tsx");
const partyCard = read("components", "party-card.tsx");
const css = read("app", "globals.css");

/** The body of `name`, up to the next top-level `function`. */
function body(source: string, name: string): string {
  const at = source.indexOf(`function ${name}(`);
  expect(at, `${name} has been renamed`).toBeGreaterThan(-1);
  const next = source.indexOf("\nfunction ", at + 1);
  return source.slice(at, next === -1 ? undefined : next);
}

// The chevron used to have a COLUMN, at the row's left edge, held open on every row so a folding
// one and a plain one lined up. That column put a 46px drop icon 39px in from the card, measured
// against globals.css in a headless browser, and most rows had nothing to open.
//
// It hangs off the drop's NAME now. A name is not a column, so there is nothing to reserve and
// nothing to line up: a row that does not fold draws no chevron at all, and the art leads the row.
describe("a Drop Log chevron hangs off the name, not off a column", () => {
  const rows = [
    ["the drop list's row", "DropRow", page],
    ["the Settled View's row", "SettledRow", settled],
    ["a fold's character heading", "RunGroup", page],
  ] as const;

  it.each(rows)("%s pairs the chevron with the name", (_what, fn, source) => {
    const row = body(source, fn);
    const line = row.indexOf("droplog-name-line");
    const toggle = row.indexOf("party-row-toggle");
    expect(
      line,
      "droplog-name-line is gone, so the chevron has no name to sit beside",
    ).toBeGreaterThan(-1);
    expect(toggle, "the chevron is gone").toBeGreaterThan(-1);
    expect(
      toggle,
      "the chevron is outside the name line, which is where a column starts",
    ).toBeGreaterThan(line);
  });

  // The bug, stated as itself: art first, and nothing held in front of it.
  it.each([
    ["the drop list's row", "DropRow", page],
    ["the Settled View's row", "SettledRow", settled],
  ] as const)("%s leads with the drop's art", (_what, fn, source) => {
    const row = body(source, fn);
    const icon = row.indexOf("loot-icon");
    const toggle = row.indexOf("party-row-toggle");
    expect(icon, "loot-icon is gone").toBeGreaterThan(-1);
    expect(
      toggle,
      "the chevron is back in front of the art, which is the 39px gutter",
    ).toBeGreaterThan(icon);
  });

  // A held-open frame is what the gutter WAS. It has no job here any more, and one left behind is
  // 28px of nothing at whichever end it was left at.
  it.each([
    ["the drop list's row", "DropRow", page],
    ["the Settled View's row", "SettledRow", settled],
    ["the skeleton's row", "Row", skeleton],
  ] as const)("%s reserves no frame", (_what, fn, source) => {
    expect(body(source, fn)).not.toContain("party-row-toggle is-empty");
  });

  // The skeleton is the page's shape or it is a height jump. See drop-log-skeleton.test.ts.
  it("gives the skeleton's row the same name line the real one has", () => {
    expect(body(skeleton, "Row")).toContain("droplog-name-line");
  });

  // Not an app-wide move. A party row is a heading with no art in front of it, so its chevron has
  // nothing to push aside and stays where the eye starts, frame and all. Pinned so the two
  // conventions stay a decision rather than drift.
  it("leaves the chevron in front of a party row, which has no art to lead with", () => {
    const toggle = partyCard.indexOf("party-row-toggle");
    const heading = partyCard.indexOf("party-row-heading");
    expect(toggle, "party-row-toggle is gone from party-card").toBeGreaterThan(-1);
    expect(heading, "party-row-heading is gone from party-card").toBeGreaterThan(-1);
    expect(toggle).toBeLessThan(heading);
    expect(partyCard).toContain("party-row-toggle is-empty");
  });

  // The name line sizes to its content. Left to stretch across the title's column it would put the
  // chevron out where the status chip begins, which is the gutter again, pointing the other way.
  it("sizes the name line to its content", () => {
    const at = css.indexOf(".droplog-name-line {");
    expect(at, ".droplog-name-line is missing").toBeGreaterThan(-1);
    const rule = css.slice(at, css.indexOf("}", at));
    expect(rule).toMatch(/width:\s*max-content/);
  });
});
