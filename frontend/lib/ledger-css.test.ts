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

// The picker replaced three labelled boxes, so it carries their words ("they took mine, at a price")
// and needs the same room the looter select gets. Unstyled it renders at the browser default and the
// longest option is what clips.
describe("the disposition picker", () => {
  it("is sized like the other select this app styles", () => {
    expect(css).toMatch(/\.ledger-sale select\.split-input \{/);
  });
});

// The instruction is a count above the control it is about. Muted and tabular, so a changing number
// does not shift the box beneath it.
describe("the progress line", () => {
  it("is tabular, so the digits do not jitter as it counts", () => {
    const rule = css.match(/\.ledger-progress \{([^}]*)\}/);
    expect(rule?.[1]).toContain("font-variant-numeric: tabular-nums");
  });
});
