import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");

// The × that removes a tranche is a `button.link`, whose own rule is an underlined accent colour.
// A plain `.ledger-drop-sale` loses to it on specificity, and the discard silently becomes what
// looks like a link out of the page. Nothing the component can assert about itself.
describe("the control that drops a sale", () => {
  it("beats button.link, which is element-qualified", () => {
    expect(css).toMatch(/button\.ledger-drop-sale \{/);
  });
});
