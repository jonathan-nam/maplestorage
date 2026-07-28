import { describe, expect, it } from "vitest";
import { BOSS_ART, BOSS_ART_2X, BOSS_NAMES, BOSS_SHORT_NAMES } from "./boss-art";

// boss-art.ts is generated from catalog/bosses.yaml, and catalog/build.py --check keeps it in
// step. These guard the shape rather than the contents: a generator that emitted an empty object
// or a wrong path prefix would still typecheck, and the only symptom would be portraits that
// quietly stop preloading, which looks exactly like the slowness this file exists to fix.
describe("BOSS_ART", () => {
  it("covers the tracked catalog rather than a subset of it", () => {
    expect(Object.keys(BOSS_ART).length).toBe(17);
  });

  it("points at the backend's boss-icons route, keyed by boss key", () => {
    for (const [key, path] of Object.entries(BOSS_ART)) {
      expect(path).toBe(`/boss-icons/${key}.png`);
    }
  });
});

describe("BOSS_ART_2X", () => {
  it("covers every boss BOSS_ART does, or one loses its art on Run Order alone", () => {
    expect(Object.keys(BOSS_ART_2X)).toEqual(Object.keys(BOSS_ART));
  });

  it("names the @2x asset and not the 26px one", () => {
    for (const [key, path] of Object.entries(BOSS_ART_2X)) {
      expect(path).toBe(`/boss-icons/${key}@2x.png`);
    }
  });

  it("is a different file from BOSS_ART, which is the whole point of having both", () => {
    for (const key of Object.keys(BOSS_ART)) {
      expect(BOSS_ART_2X[key]).not.toBe(BOSS_ART[key]);
    }
  });
});

describe("BOSS_NAMES", () => {
  it("names exactly the bosses there is art for", () => {
    expect(Object.keys(BOSS_NAMES)).toEqual(Object.keys(BOSS_ART));
  });

  it("carries the catalog's own spelling rather than one derived from the key", () => {
    // The derivation this guards against is title-casing the key, which would capitalise the
    // "the" here. It is the reason the names are generated at all.
    expect(BOSS_NAMES["kalos-the-guardian"]).toBe("Kalos the Guardian");
  });
});

describe("BOSS_SHORT_NAMES", () => {
  it("holds only bosses that are also named and drawn", () => {
    for (const key of Object.keys(BOSS_SHORT_NAMES)) {
      expect(BOSS_NAMES[key]).toBeDefined();
    }
  });

  it("is shorter than the full name, or it is not a shorthand", () => {
    for (const [key, short] of Object.entries(BOSS_SHORT_NAMES)) {
      expect(short.length).toBeLessThan((BOSS_NAMES[key] as string).length);
    }
  });

  it("says what a party says", () => {
    expect(BOSS_SHORT_NAMES["malefic-star"]).toBe("Star");
    expect(BOSS_SHORT_NAMES["kalos-the-guardian"]).toBe("Kalos");
    // A boss whose name is already what everyone calls it does not get an entry.
    expect(BOSS_SHORT_NAMES["lotus"]).toBeUndefined();
  });
});
