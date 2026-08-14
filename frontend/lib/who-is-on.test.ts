import { describe, expect, it } from "vitest";
import { AWAY_KEY, readAway, writeAway } from "@/lib/who-is-on";

function fakeStore(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

const throwingStore = {
  getItem() {
    throw new Error("storage is blocked");
  },
  setItem() {
    throw new Error("storage is blocked");
  },
};

describe("who is on tonight", () => {
  it("has everybody on for someone who has never answered", () => {
    expect(readAway(fakeStore())).toEqual([]);
  });

  it("survives the round trip", () => {
    const store = fakeStore();
    writeAway(["you", "b8a"], store);
    expect(readAway(store)).toEqual(["you", "b8a"]);
    writeAway([], store);
    expect(readAway(store)).toEqual([]);
  });

  it("stores the ones who are away, under its own key", () => {
    const store = fakeStore();
    writeAway(["b8a"], store);
    expect(store.data.get(AWAY_KEY)).toBe(JSON.stringify(["b8a"]));
  });

  // The alternative to refusing junk is a roster the page cannot draw, or a night planned around
  // an id that is not a person.
  it("reads anything it does not recognise as nobody away", () => {
    expect(readAway(fakeStore({ [AWAY_KEY]: "not json" }))).toEqual([]);
    expect(readAway(fakeStore({ [AWAY_KEY]: '{"you":true}' }))).toEqual([]);
  });

  it("keeps only the ids that are strings", () => {
    expect(readAway(fakeStore({ [AWAY_KEY]: '["you",7,null,"b8a"]' }))).toEqual(["you", "b8a"]);
  });

  // Safari in private mode, and any browser with storage switched off, throws on access rather
  // than returning null.
  it("has everybody on when storage is missing or throws", () => {
    expect(readAway(null)).toEqual([]);
    expect(() => writeAway(["you"], null)).not.toThrow();
    expect(readAway(throwingStore)).toEqual([]);
    expect(() => writeAway(["you"], throwingStore)).not.toThrow();
  });
});
