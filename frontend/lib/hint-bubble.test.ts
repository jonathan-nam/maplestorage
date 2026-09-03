import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");
const bubble = readFileSync(join(__dirname, "..", "components", "hint-bubble.tsx"), "utf8");
const page = readFileSync(join(__dirname, "..", "app", "bosses", "order", "page.tsx"), "utf8");

/** The declarations in the first rule with this exact selector. */
function ruleOf(selector: string): string {
  const at = css.indexOf(`${selector} {`);
  expect(at, `${selector} is missing`).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf("}", at));
}

describe("a hint bubble", () => {
  it("stays in the DOM, since aria-describedby has to read it", () => {
    // visibility/opacity, never a conditional render: a description that is not there is not read.
    expect(ruleOf(".hint-bubble")).toContain("visibility: hidden");
    expect(ruleOf(".hint-bubble")).not.toContain("display: none");
    expect(bubble).toMatch(/role="tooltip" className="hint-bubble"/);
    expect(bubble).toMatch(/aria-describedby=\{hintId\}/);
  });

  it("is reachable without a pointer", () => {
    // A bubble that only answers to hover is no hint on a touch screen, and none to a keyboard.
    expect(bubble).toMatch(/<button type="button" className="hint-mark"/);
    expect(css).toMatch(/\.hint-mark:focus-visible \+ \.hint-bubble/);
  });

  it("gives the mark a target big enough to hit", () => {
    // WCAG 2.5.8's floor, around a 14px glyph.
    expect(ruleOf(".hint-mark")).toContain("width: 24px");
    expect(ruleOf(".hint-mark")).toContain("height: 24px");
  });

  it("hangs off a row rather than off the mark, so it cannot run off a phone", () => {
    expect(ruleOf(".night-toggle-row")).toContain("position: relative");
    expect(ruleOf(".hint")).not.toContain("position: relative");
    expect(ruleOf(".hint-bubble")).toContain("left: 0");
  });
});

describe("the subsets box on Run Order", () => {
  it("says what it excludes, in the words the box uses", () => {
    expect(page).toContain("<span>Exclude Party Member Subsets</span>");
    expect(page).toMatch(
      /Three people on get the three-person party, not its duos and solos as well\./,
    );
  });

  // A <button> inside a <label> is the label's control: asking what the box does would tick it.
  it("keeps the mark outside the label", () => {
    const label = page.indexOf("Exclude Party Member Subsets");
    const closes = page.indexOf("</label>", label);
    const mark = page.indexOf("<HintBubble", label);
    expect(mark).toBeGreaterThan(closes);
  });
});
