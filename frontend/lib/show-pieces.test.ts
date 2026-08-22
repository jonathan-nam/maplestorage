import { describe, expect, it } from "vitest";
import { readShowPieces, SHOW_PIECES_KEY, writeShowPieces } from "@/lib/show-pieces";
import { SHOW_TIMES_KEY } from "@/lib/show-times";

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

describe("show pieces preference", () => {
  it("shows the pieces for someone who has never answered", () => {
    expect(readShowPieces(fakeStore())).toBe(true);
  });

  it("survives the round trip in both directions", () => {
    const store = fakeStore();
    writeShowPieces(false, store);
    expect(readShowPieces(store)).toBe(false);
    writeShowPieces(true, store);
    expect(readShowPieces(store)).toBe(true);
  });

  it("stores off under its own key", () => {
    const store = fakeStore();
    writeShowPieces(false, store);
    expect(store.data.get(SHOW_PIECES_KEY)).toBe("off");
  });

  // Both boxes are one factory away from each other, so a copied key would leave the clock and the
  // pieces sharing a preference and neither box able to say which.
  it("does not share the times key", () => {
    expect(SHOW_PIECES_KEY).not.toBe(SHOW_TIMES_KEY);
    const store = fakeStore();
    writeShowPieces(false, store);
    expect(store.data.get(SHOW_TIMES_KEY)).toBeUndefined();
  });

  it("shows the pieces when storage is missing or throws", () => {
    expect(readShowPieces(null)).toBe(true);
    expect(() => writeShowPieces(false, null)).not.toThrow();
    expect(readShowPieces(throwingStore)).toBe(true);
    expect(() => writeShowPieces(false, throwingStore)).not.toThrow();
  });
});
