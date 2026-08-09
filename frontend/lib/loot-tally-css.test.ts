import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");

// Who is up for the next drop is said by a border, not by a sentence: takenTally marks every seat
// on the fewest and .is-up is the whole of how that reaches the screen. If the rule goes, the
// component still renders and the class is still there, and the tally quietly becomes a row of
// numbers with nothing distinguishing the answer. Nothing the component can assert about itself.
describe("the seat who is up for the next drop", () => {
  it("is drawn differently from the seats who are not", () => {
    expect(css).toMatch(/\.loot-tally > li\.is-up \{/);
  });
});
