import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");

function rule(selector: string): string {
  const m = css.match(new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`));
  if (!m) throw new Error(`no rule for ${selector}`);
  return m[1] ?? "";
}

// Add Party's row shipped wrapping its + onto a line of its own, where a + names nothing. The cause
// is not obvious from the markup: a wrapping flex row breaks lines at each item's BASE size and
// only shrinks what already sits on a line, so flex-shrink cannot rescue a row that does not fit,
// and a basis of auto makes a <select> as wide as its longest option. Ours is 26 characters ("every
// boss is on this week"), which at the page's 794px overflowed a 685px card.
//
// Nothing the component can assert about itself, and the failure is invisible until somebody adds a
// longer boss to catalog/bosses.yaml. So the numbers are pinned here.
describe("the add row", () => {
  it("gives every field an explicit flex-basis, so the catalog cannot set the layout", () => {
    const field = rule(".add-party-field");
    // A bare `flex: 1 1 auto` or no flex at all is the bug coming back.
    expect(field).toMatch(/flex:\s*1\s+1\s+\d+px/);
    expect(rule(".add-party-field.is-wide")).toMatch(/flex:\s*2\s+1\s+\d+px/);
  });

  it("lets a field shrink, which min-width:auto otherwise forbids", () => {
    expect(rule(".add-party-field")).toMatch(/min-width:\s*0/);
    expect(rule(".add-party-field .split-input")).toMatch(/min-width:\s*0/);
  });

  it("keeps the + out of the wrap, so it is never the thing left alone on a line", () => {
    expect(rule(".add-party-fields .party-add-icon")).toMatch(/flex:\s*none/);
  });

  // The bases have to actually fit the card they are in, which is the whole point. The page is
  // --measure wide with .page's 2rem either side and .add-party-card's 14px either side.
  it("fits its four fields and the + across the page's own width", () => {
    const measure = Number(css.match(/--measure:\s*(\d+)px/)?.[1]);
    const inner = measure - 2 * 32 - 2 * 14;
    const basis = (selector: string) =>
      Number(rule(selector).match(/flex:\s*\d\s+1\s+(\d+)px/)?.[1]);
    const gap = Number(rule(".add-party-fields").match(/gap:\s*(\d+)px/)?.[1]);
    const button = Number(rule(".party-add-icon").match(/width:\s*(\d+)px/)?.[1]);

    const narrow = basis(".add-party-field");
    const wide = basis(".add-party-field.is-wide");
    // Character + Difficulty are narrow, Boss + Member wide, then the +, with four gaps between.
    const total = 2 * narrow + 2 * wide + button + 4 * gap;
    expect(total).toBeLessThanOrEqual(inner);
  });
});
