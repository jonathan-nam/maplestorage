import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");

// The per-row time column is gone: the clock is a rule across the table every half hour, so no row
// draws a time and nothing has to reserve the width of one. What is left to pin is that the rule
// reads as a gridline rather than as another row of the plan.
describe("the half-hour rule", () => {
  const rule = () => {
    const at = css.indexOf(".run-tick td {");
    expect(at, ".run-tick td is missing").toBeGreaterThan(-1);
    return css.slice(at, css.indexOf("}", at));
  };

  it("draws a solid line, where a wait row draws a dashed one", () => {
    expect(rule()).toMatch(/border-top:\s*1px solid/);
    const wait = css.indexOf(".run-wait td {");
    expect(css.slice(wait, css.indexOf("}", wait))).toMatch(/border-top:\s*1px dashed/);
  });

  it("lines the times up, being a column of numbers", () => {
    const at = css.indexOf(".run-tick-at {");
    expect(at, ".run-tick-at is missing").toBeGreaterThan(-1);
    expect(css.slice(at, css.indexOf("}", at))).toMatch(/font-variant-numeric:\s*tabular-nums/);
  });

  it("takes no hover, being a rule and not a row you can read across", () => {
    expect(css).toMatch(/\.run-tick:hover\s*\{[^}]*background:\s*none/);
  });

  it("keeps no width reserved for a time on the row", () => {
    expect(css).not.toMatch(/\.run-time\s*\{/);
  });
});

// A wait row sits between two runs, and now a rule row does too, so :nth-child banding counts both
// and inverts the stripes under every gap. The component bands from the row's own index instead,
// which only works if the CSS is asking for the class rather than the position.
describe("the plan's banding", () => {
  it("bands on a class, not on where the row happens to sit", () => {
    expect(css).toMatch(/\.run-table tbody tr\.is-banded/);
    expect(css).not.toMatch(/\.run-table tbody tr:nth-child/);
  });
});

// A plan tab carries two numbers, so a row of them that cannot wrap breaks the labels instead and
// each chip grows a second line. Measured at 420px with four tabs: 38px tall chips on one row
// before, 23px tall chips over two rows after.
describe("the plan tabs", () => {
  const rule = (selector: string) => {
    const at = css.indexOf(`${selector} {`);
    expect(at, `${selector} is missing`).toBeGreaterThan(-1);
    return css.slice(at, css.indexOf("}", at));
  };

  it("wraps between tabs", () => {
    expect(rule(".basis-row")).toMatch(/flex-wrap:\s*wrap/);
  });

  it("never wraps inside one", () => {
    expect(rule(".basis-tab")).toMatch(/white-space:\s*nowrap/);
  });

  it("leaves the copy button where the markup puts it, at the start of the line", () => {
    expect(css).not.toMatch(/\.night-plan-copy \.copy-amount\s*\{[^}]*margin-left:\s*auto/);
  });

  // A row put the tabs beside the button while there was space for them and under it once there
  // was not, so the button moved with the tab count. It sits above them either way now.
  it("keeps the copy button on a line of its own above them", () => {
    expect(rule(".night-plan-copy")).toMatch(/flex-direction:\s*column/);
  });
});
