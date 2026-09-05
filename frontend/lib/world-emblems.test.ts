import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { WORLDS_IN, emblemFor } from "./world-names";

// The emblems are committed output, so nothing at build or CI time re-cuts them and nothing at
// build or CI time would notice one missing. A world added to GmsWorld.kt reaches the card through
// WORLDS_IN on its own, art or no art, and the card would render a broken image for it.

const PUBLIC = join(__dirname, "..", "public");

/** width and height from the PNG's IHDR, which is always the first chunk. */
function size(file: string): { width: number; height: number } {
  const raw = readFileSync(file);
  return { width: raw.readUInt32BE(16), height: raw.readUInt32BE(20) };
}

const worlds = Object.values(WORLDS_IN).flat();

describe("every world has an emblem", () => {
  it("has one for each world the cards name", () => {
    const missing = worlds.filter((w) => !existsSync(join(PUBLIC, emblemFor(w))));
    expect(
      missing,
      `no emblem for ${missing.join(", ")}. Run \`pnpm worlds\` to cut it from the game's world ` +
        `select art, and look at the result: the pill knockout can eat a light highlight.`,
    ).toEqual([]);
  });

  // EMBLEM_CANVAS in build-world-emblems.mjs, and the natural size .world-emblem is registered at
  // in pixel-scaling-css.test.ts. All three have to agree or the card draws pixel art at a
  // fractional ratio, which is the thing that guard exists to refuse.
  it("cuts them all to the one canvas the card draws at", () => {
    for (const world of worlds) {
      expect(size(join(PUBLIC, emblemFor(world))), world).toEqual({ width: 20, height: 20 });
    }
  });
});
