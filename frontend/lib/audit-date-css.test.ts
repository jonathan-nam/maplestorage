import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatDroppedWithYear } from "./loot";

const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");

// `.audit-when` is a FIXED width, so the dates line up down the left and an undated row keeps its
// column. That makes the column and the format one decision: the year went onto these dates and
// "10 May 2026" (78px, the widest the formatter can produce) wrapped to two lines in the 72px the
// column was, which reads as a blank line rather than as a date.
//
// The 78px is a browser measurement and this file cannot repeat it. What it can pin is the two
// things that would invalidate it: the format growing, and the column shrinking. So it measures the
// format in CHARACTERS against the width that was measured for the format at this length. A move to
// full month names ("10 September 2026") fails here, next to the number it has to clear.

const WIDTH_PX = 88;
const MEASURED_AT_CHARS = 11; // "10 May 2026", the widest formatDroppedWithYear has ever produced

/** Every date the formatter can be given, at its longest: two-digit days, every month. */
function longest(): string {
  let widest = "";
  for (let month = 1; month <= 12; month++) {
    for (const day of [1, 10, 22, 30]) {
      const iso = `2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const said = formatDroppedWithYear(iso);
      if (said.length > widest.length) widest = said;
    }
  }
  return widest;
}

describe("the date column on one drop's history", () => {
  it("is as wide as the sheet says it was measured to be", () => {
    expect(css).toMatch(new RegExp(`\\.audit-when \\{[^}]*width: ${WIDTH_PX}px`));
  });

  it("holds a date no longer than the one that width was measured for", () => {
    const widest = longest();
    expect(
      widest,
      `${widest} is longer than the ${WIDTH_PX}px column was measured for`,
    ).toHaveLength(MEASURED_AT_CHARS);
  });

  it("still says the year, which is the whole reason the column grew", () => {
    expect(formatDroppedWithYear("2026-05-10")).toContain("2026");
  });
});
