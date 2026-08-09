import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");

/** The declarations in the first rule with this exact selector, as `property` names. */
function propertiesOf(selector: string): string[] {
  const at = css.indexOf(`${selector} {`);
  expect(at, `${selector} is missing`).toBeGreaterThan(-1);
  const body = css.slice(at + selector.length + 2, css.indexOf("}", at));
  return body
    .split(";")
    .map((line) => (line.split(":")[0] ?? "").trim())
    .filter((property) => property.length > 0);
}

// Untick Show times and every time control stays where it was, disabled. That only holds while the
// off state is drawn with properties that cannot resize a box: one `display: none` or one padding
// here and the page jumps under the cursor that ticked it again, which is what this replaced.
const NON_LAYOUT = ["opacity", "color", "background", "border-color", "cursor", "filter"];

describe("the off state of a time control", () => {
  for (const selector of [".night-off", ".night-chip-set:disabled", ".night-pin.is-off"]) {
    it(`${selector} changes nothing that has a size`, () => {
      for (const property of propertiesOf(selector)) {
        expect(NON_LAYOUT, `${selector} sets ${property}`).toContain(property);
      }
    });
  }
});
