import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { WORLDS_IN } from "./world-names";

// GmsWorld.kt is the source of truth for which worlds exist and which category each is in, and it
// says so itself: every row was pinned against a named character, and it "goes stale silently" when
// GMS merges or adds a world. This test is what makes it go stale loudly on this side.

const GMS_WORLD_KT = join(
  __dirname,
  "..",
  "..",
  "backend",
  "src",
  "main",
  "kotlin",
  "com",
  "sharpeyes",
  "backend",
  "users",
  "GmsWorld.kt",
);

/** The enum rows, as `NAME(id, "Display", WORLD_TYPE)`. */
function worldsFromKotlin(): Record<string, string[]> {
  const source = readFileSync(GMS_WORLD_KT, "utf8");
  const rows = source.matchAll(/^ {4}[A-Z]+\(\d+, "([A-Za-z]+)", WORLD_([A-Z]+)\),$/gm);
  const worlds: Record<string, string[]> = {};
  for (const row of rows) {
    const displayName = row[1];
    const worldType = row[2];
    if (!displayName || !worldType) continue;
    (worlds[worldType] ??= []).push(displayName);
  }
  return worlds;
}

describe("WORLDS_IN", () => {
  it("names every world GmsWorld.kt does, in the same category", () => {
    expect(worldsFromKotlin()).toEqual(WORLDS_IN);
  });

  // A regex that matched nothing would leave both sides of the comparison above empty-ish and pass,
  // so what it actually read is asserted rather than assumed.
  it("read the enum at all", () => {
    const found = Object.values(worldsFromKotlin()).flat();
    expect(found).toHaveLength(4);
  });
});
