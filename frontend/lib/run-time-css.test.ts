import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");

// The run order rows lead with the time on the reset clock, and the boss art sits right of it in a
// flex row. So the time's box has to hold the widest string it can ever draw, or the art steps
// right on exactly the rows whose time carries a tilde, which reads as a broken table rather than
// as a marked estimate.
//
// Measured in chromium against the rule's own 12px font: "+2:00" is 37.0px, "~+2:30" is 47.1px,
// and "~+11:30" is 54.7px, which is 4.56em. The last one sets the number. Times run -12:00 to
// +12:00 against reset, and a minus is NARROWER than a plus in this font ("-0:15" is 31.3px
// against 37.0px for "+0:00"), so the widest string is the two-digit hour on the plus side.
describe("the run time column", () => {
  const rule = () => {
    const at = css.indexOf(".run-time {");
    expect(at, ".run-time is missing").toBeGreaterThan(-1);
    return css.slice(at, css.indexOf("}", at));
  };

  it("reserves the width of the widest time it can draw", () => {
    const width = /min-width:\s*([\d.]+)em/.exec(rule());
    expect(width, ".run-time has no min-width in em").not.toBeNull();
    expect(Number(width?.[1])).toBeGreaterThanOrEqual(4.56);
  });

  it("lines the digits up, being a column of numbers", () => {
    expect(rule()).toMatch(/font-variant-numeric:\s*tabular-nums/);
  });

  it("banks the times right, so their ends agree and the art starts flush", () => {
    expect(rule()).toMatch(/text-align:\s*right/);
  });
});

// A wait row sits between two runs, so :nth-child banding counts it and inverts the stripes under
// every gap. The component bands from the row's own index instead, which only works if the CSS is
// asking for the class rather than the position.
describe("the plan's banding", () => {
  it("bands on a class, not on where the row happens to sit", () => {
    expect(css).toMatch(/\.run-table tbody tr\.is-banded/);
    expect(css).not.toMatch(/\.run-table tbody tr:nth-child/);
  });
});
