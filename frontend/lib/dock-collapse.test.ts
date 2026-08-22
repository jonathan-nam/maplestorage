import { globSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DOCK_LABELS, dockStorageKey, readDockOpen, writeDockOpen } from "@/lib/dock-collapse";

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

describe("dock fold state", () => {
  it("opens a dock nobody has answered for", () => {
    expect(readDockOpen("inventory", fakeStore())).toBe(true);
    expect(readDockOpen("planner", fakeStore())).toBe(true);
  });

  it("survives the round trip in both directions", () => {
    const store = fakeStore();
    writeDockOpen("inventory", false, store);
    expect(readDockOpen("inventory", store)).toBe(false);
    writeDockOpen("inventory", true, store);
    expect(readDockOpen("inventory", store)).toBe(true);
  });

  it("keeps the two docks apart", () => {
    const store = fakeStore();
    writeDockOpen("planner", false, store);
    expect(readDockOpen("planner", store)).toBe(false);
    expect(readDockOpen("inventory", store)).toBe(true);
    expect(dockStorageKey("inventory")).not.toBe(dockStorageKey("planner"));
  });

  it("opens when there is no storage at all", () => {
    expect(readDockOpen("inventory", null)).toBe(true);
    expect(() => writeDockOpen("inventory", false, null)).not.toThrow();
  });

  // Safari in private mode, and any browser with storage switched off, throws on access rather
  // than returning null. A dock that cannot remember its state still has to render.
  it("opens when storage throws", () => {
    expect(readDockOpen("inventory", throwingStore)).toBe(true);
    expect(() => writeDockOpen("inventory", false, throwingStore)).not.toThrow();
  });

  // The label is the whole of the folded dock, so an empty one would leave a bar with nothing in
  // it and no way to tell the two pages' docks apart.
  it("names every dock", () => {
    for (const label of Object.values(DOCK_LABELS)) expect(label.trim().length).toBeGreaterThan(0);
  });
});

// #440 took both dropzones off their pages and left the DockSkeleton in both route boundaries.
// Nothing failed. The pages just flashed a screenshot dock, title bar, fold caret and all, for the
// length of every nav click, and it vanished the moment the page's own JS mounted.
//
// A boundary stands the chrome its page will have. A dock in one and not the other is that flash,
// in whichever direction it is missing.
describe("a boundary stands a dock only where the page draws one", () => {
  const root = join(__dirname, "..");
  const read = (f: string) => readFileSync(join(root, f), "utf8");
  const drawing = (pattern: RegExp, files: string[]) => files.filter((f) => pattern.test(read(f)));

  const boundaries = drawing(/<DockSkeleton\b/, globSync("app/**/loading.tsx", { cwd: root }));
  const pages = drawing(/<(Capture|Planner)Dock\b/, globSync("app/**/page.tsx", { cwd: root }));

  it("stands none, because no page draws one", () => {
    expect(pages, "a dock is back on a page: give its boundary the skeleton too").toEqual([]);
    expect(boundaries).toEqual([]);
  });
});
