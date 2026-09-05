import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");

// Anchored to the start of a line, or ".reset-value" also matches inside ".reset-lead .reset-value"
// and reads the wrong block: that one carries the colour and this one carries the width.
const rule = (selector: string) => {
  const at = css.indexOf(`\n${selector} {`);
  expect(at, `no rule for ${selector}`).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf("}", at));
};

/**
 * The countdown holds still because its boxes are a fixed size, not because of anything the
 * component does: .reset-part reserves one unit and .reset-value reserves four of them. Untie
 * those two numbers and the value column goes back to being sized by whichever of the two rows is
 * currently longer, which drags the label and the UTC sideways every time a digit is gained.
 *
 * Nothing in a browser checks the relation, and the symptom is a twitch nobody files a bug about.
 */
describe("the countdown's fixed boxes", () => {
  it("reserves exactly four units of the same width the unit box uses", () => {
    const part = rule(".reset-part").match(/width:\s*([\d.]+)ch/);
    const value = rule(".reset-value").match(/width:\s*calc\(4\s*\*\s*([\d.]+)ch\)/);

    expect(part, ".reset-part has no ch width").not.toBeNull();
    expect(value, ".reset-value is not four part-widths").not.toBeNull();
    expect((value as RegExpMatchArray)[1]).toBe((part as RegExpMatchArray)[1]);
  });

  it("reserves two digits for every number", () => {
    expect(rule(".reset-num")).toMatch(/min-width:\s*2ch/);
  });

  // Both rows are read as a pair of columns. Bold digits are wider than regular ones even in a
  // tabular face, so a weight difference between the two rows is a misalignment.
  it("separates the two rows by colour and not by weight", () => {
    expect(rule(".reset-lead .reset-value")).not.toMatch(/font-weight/);
  });
});
