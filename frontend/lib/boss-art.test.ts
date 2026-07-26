import { describe, expect, it } from "vitest";
import { BOSS_ART } from "./boss-art";

// boss-art.ts is generated from catalog/bosses.yaml, and catalog/build.py --check keeps it in
// step. These guard the shape rather than the contents: a generator that emitted an empty object
// or a wrong path prefix would still typecheck, and the only symptom would be portraits that
// quietly stop preloading, which looks exactly like the slowness this file exists to fix.
describe("BOSS_ART", () => {
  it("covers the tracked catalog rather than a subset of it", () => {
    expect(Object.keys(BOSS_ART).length).toBe(16);
  });

  it("points at the backend's boss-icons route, keyed by boss key", () => {
    for (const [key, path] of Object.entries(BOSS_ART)) {
      expect(path).toBe(`/boss-icons/${key}.png`);
    }
  });
});
