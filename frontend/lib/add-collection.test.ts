import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The Collection Ledger draws a card per person who already owes you something, which cannot open
// the FIRST debt of a relationship: a loan to somebody you have never split a drop with had nowhere
// to be entered at all.
//
// Source tests, like ledger-fates.test.ts, because the invariants are in JSX and in wiring. The
// failure mode is silent in exactly the way that one describes: the control stops being drawn, and
// what disappears with it is the only way to record a whole kind of debt.

const root = join(__dirname, "..");
const component = readFileSync(join(root, "components", "add-collection.tsx"), "utf8");
const page = readFileSync(join(root, "app", "bosses", "drops", "page.tsx"), "utf8");

describe("the way in for somebody with no card", () => {
  it("is drawn on the collection tab", () => {
    expect(page).toContain("<AddCollection");
  });

  it("writes to the same endpoint a card's own box writes to", () => {
    // Two ways to enter a debt is fine. Two SHAPES of debt row is not: they have to be one thing so
    // a mistyped one is removable from the card it lands on.
    const wiring = page.slice(page.indexOf("<AddCollection"));
    expect(wiring.slice(0, 400)).toContain("debtWrite(DEBTS_KEY");
  });

  it("picks a PERSON, since a debt is between two humans", () => {
    expect(component).toContain('kind: "PERSON"');
    expect(component).toContain("people.map");
  });

  it("asks in the card's own words, so it is not a second vocabulary", () => {
    expect(component).toContain("owes me");
    expect(component).toContain('placeholder="1.5b"');
    expect(component).toContain('placeholder="what for"');
  });

  it("draws nothing when there is nobody to pick", () => {
    // A picker of nobody is a control that cannot be completed, which is worse than no control.
    expect(component).toContain("if (people.length === 0) return null;");
  });
});
