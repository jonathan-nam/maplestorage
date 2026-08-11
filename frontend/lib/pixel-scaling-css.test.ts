import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");

// The rule globals.css states next to `.ms-slot > img`, enforced instead of only written down:
// nearest-neighbour at a non-integer ratio drops or duplicates rows unevenly, so a straight edge
// grows a step in it and a 1px highlight disappears. It has now been broken three times, each
// time by a box sized by eye against art whose natural size lives somewhere else entirely.
//
// So the natural sizes are named here. They are facts about assets, not about this file, and each
// one is checked by a test that reads the asset rather than trusting this table:
//   - vision/tests/test_boss_portraits.py pins the two boss sizes.
//   - catalog/build.py pins the 46px icon canvas (ICON_CANVAS) and refuses art that misses it.
//     It only started reading the assets' real dimensions once a 37x37 drop icon had been sitting
//     in a 46px box; before that it checked the file existed and nothing more.
//   - 96 is what the Nexon avatar endpoint returns; see .tile-sprite's comment.
const NATURAL = {
  ".ms-slot > img": 46, // item icon canvas
  ".loot-icon": 46,
  ".finder-suggest-row img": 46,
  ".drop-select-icon": 46,
  ".drop-select > .drop-select-icon": 46, // half size in the closed field
  ".finder-row li img": 46,
  ".boss-portrait": 26, // planner portrait, the game's own size
  ".run-art": 80, // the @2x portrait, BOSS_ART_2X
  ".tile-sprite": 96, // Nexon avatar render
  ".character-row-sprite": 96,
  ".boss-char-sprite": 96,
  ".roster-sprite": 96,
  ".party-banner-sprite": 96,
  ".seat-sprite": 96,
} as const;

/** The declared width of a rule, and whether it asks for nearest-neighbour. */
function rule(selector: string): { width: number; nearest: boolean } {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const body = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1];
  expect(body, `no rule for ${selector}`).toBeDefined();
  const width = /width:\s*(\d+)px/.exec(body as string);
  expect(width, `${selector} declares no px width`).not.toBeNull();
  return {
    width: Number(width?.[1]),
    nearest: /image-rendering:\s*pixelated/.test(body as string),
  };
}

describe("pixel art is only ever drawn at a whole-number ratio", () => {
  for (const [selector, natural] of Object.entries(NATURAL)) {
    it(`${selector} scales its ${natural}px source by a whole number`, () => {
      const { width, nearest } = rule(selector);
      if (!nearest) return; // A smooth filter is safe at any ratio; only nearest is not.
      const ratio = width >= natural ? width / natural : natural / width;
      expect(
        Number.isInteger(ratio),
        `${selector} draws ${natural}px art in a ${width}px box (${ratio.toFixed(3)}x)`,
      ).toBe(true);
    });
  }
});

describe("the boss portrait sizes stay matched to the assets that exist", () => {
  it("draws Run Order's portrait smaller than the asset it is given", () => {
    // If the box ever grows past 80 this goes back to enlarging pixel art, and the fix is a
    // bigger asset from build_boss_portraits.py rather than a bigger number here.
    expect(rule(".run-art").width).toBeLessThanOrEqual(NATURAL[".run-art"]);
  });

  it("draws the 26px portrait at its own size, and half it for the small one", () => {
    expect(rule(".boss-portrait").width).toBe(26);
    expect(rule(".boss-portrait.is-small").width).toBe(13);
  });
});
