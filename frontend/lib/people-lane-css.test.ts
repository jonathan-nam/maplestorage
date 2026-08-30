import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// `.person-chips` reserves one card's height so a person with nobody yet does not sit shorter than
// the row above them. That number cannot be worked out in CSS (the name's line box is not declared
// anywhere), so it is measured and written down, which makes it exactly the kind of number CLAUDE.md
// says must be pinned or it rots: growing the sprite, the grip or the card's padding all move it.
//
// So this checks the reservation still spans its parts, with one line of slack for the name. Same
// source-reading approach as pixel-scaling-css.test.ts.

const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");
const sheet = css.replace(/\/\*[\s\S]*?\*\//g, "");

function body(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^{}]*)\\}`).exec(sheet);
  if (match === null) throw new Error(`no rule for ${selector}`);
  return match[1]!;
}

const px = (selector: string, property: string): number => {
  const found = new RegExp(`(?<![-\\w])${property}:\\s*(-?[\\d.]+)px`).exec(body(selector));
  if (found === null) throw new Error(`${selector} declares no px ${property}`);
  return Number(found[1]);
};

/** The two paddings and the two borders a shorthand puts on one axis. */
const paddingY = (selector: string): number => {
  const found = /padding:\s*([\d.]+)px/.exec(body(selector));
  if (found === null) throw new Error(`${selector} declares no padding`);
  return Number(found[1]) * 2;
};

describe("a person's lane reserves one whole card", () => {
  const parts =
    px(".roster-sprite", "height") +
    px(".person-grip", "height") +
    px(".person-grip", "margin-bottom") +
    paddingY(".person-chip") +
    2; // the card's 1px border, top and bottom

  const reserved = px(".person-chips", "min-height");

  it("reserves at least everything the card is made of", () => {
    expect(
      reserved,
      `.person-chips reserves ${reserved}px for a card whose parts already come to ${parts}px, so ` +
        `a lane holding one card is taller than an empty one and the rows go ragged.`,
    ).toBeGreaterThanOrEqual(parts);
  });

  it("reserves no more than those parts plus the name's line", () => {
    // The name is one line of --text-sm. Anything beyond that is a gap nobody asked for.
    expect(
      reserved - parts,
      `.person-chips reserves ${reserved - parts}px beyond the card's parts, which is more than the ` +
        `single line of text that has to fit there.`,
    ).toBeLessThanOrEqual(24);
  });
});
