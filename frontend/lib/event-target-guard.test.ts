import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// A React event's `currentTarget` is null once the handler returns, so reading it inside anything
// that runs LATER is a null dereference waiting for the first click.
//
// It cost exactly that: the inventory popup measured its slot inside a `setState` updater, which
// React calls during the update rather than during the handler, and every first click on an item
// threw "Cannot read properties of null (reading 'getBoundingClientRect')". It type-checked
// perfectly: `currentTarget` is typed as the element, not as element-or-null.
//
// So this reads the source. There is no render harness here, and the mistake is invisible to both
// the compiler and to any test that does not actually click. Same approach as
// piece-row-guard.test.ts and share-boxes-guard.test.ts.
//
// Comments are stripped first, or the paragraph above would match itself.

const root = join(__dirname, "..");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules" || name === ".next") return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx$/.test(name) && !name.includes(".test.") ? [path] : [];
  });
}

const code = (path: string) =>
  readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ");

describe("an event's target is read while the event is still live", () => {
  it("never reaches for currentTarget inside a state updater", () => {
    // The shape of the bug rather than the one instance: `setX((prev) => ... e.currentTarget ...)`.
    // The updater body is what runs late, so currentTarget inside it is null by then.
    const offenders: string[] = [];
    for (const file of [...sources(join(root, "components")), ...sources(join(root, "app"))]) {
      const text = code(file);
      // A set* call whose argument is an arrow function, captured up to the closing paren of that
      // call, then checked for a currentTarget read.
      for (const match of text.matchAll(
        /\bset[A-Z]\w*\(\s*\([^)]*\)\s*=>([\s\S]{0,400}?)\)\s*[;,}]/g,
      )) {
        if (/currentTarget/.test(match[1] ?? "")) {
          offenders.push(file.replace(root, ""));
        }
      }
    }
    expect(
      offenders,
      "currentTarget read inside a state updater, which runs after it is null",
    ).toEqual([]);
  });

  it("still sees the file it is guarding, with the comments gone", () => {
    // The stripper is load-bearing: one that ate everything would make the check above pass by
    // matching nothing at all.
    const grid = code(join(root, "components", "slot-grid.tsx"));
    expect(grid).toContain("const anchor = e.currentTarget.getBoundingClientRect();");
    expect(grid).not.toContain("Measured HERE");
  });
});
