import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TILES_SHOWN } from "./carousel";

const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");

// The strip's cap is a width in CSS, the placeholders' is a count in TS, and nothing at runtime
// compares them. Move one and the loading strip is a tile wider than the strip that replaces it,
// which is the jump the skeletons exist to prevent.
describe("how many sprites a strip shows", () => {
  it("is the same number in the CSS cap and in TILES_SHOWN", () => {
    const cap = css.match(/\.carousel-track \{[^}]*max-width: calc\((\d+) \* var\(--tile-outer\)/);
    expect(cap?.[1]).toBe(String(TILES_SHOWN));
  });
});
