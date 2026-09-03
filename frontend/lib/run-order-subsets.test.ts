import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const page = readFileSync(join(__dirname, "..", "app", "bosses", "order", "page.tsx"), "utf8");

describe("the subsets box on Run Order", () => {
  it("says what it excludes, and says only that", () => {
    expect(page).toContain("<span>Exclude Party Member Subsets</span>");
    // The label is the whole of it. A hint bubble beside it was built and taken off again: what
    // ticking it does is visible in the plan the moment you tick it.
    expect(page).not.toContain("HintBubble");
  });
});
