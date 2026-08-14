import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { StaleAfterWrite, readBack } from "./api";

// A write that landed must never be reported as a write that did not.
//
// The mistake is not in one function, it is in a SHAPE: POST and refetch, both awaited in one try,
// so the pair reads as one action. Four screens log a drop that way. A refetch that 401s on a stale
// token made every one of them say "That didn't save." over a row that was already in the database,
// and two of them then held the picker loaded "ready to try again": one Hard Kaling night went in
// twice, 60 coupons each. Nothing a unit test on a single page can catch, since each of the four
// names its own refetch and its own error state.

const root = join(__dirname, "..");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !name.includes(".test.") ? [path] : [];
  });
}

const files = [...sources(join(root, "app")), ...sources(join(root, "components"))].map((path) => ({
  file: path.slice(root.length + 1),
  text: readFileSync(path, "utf8"),
}));

describe("readBack", () => {
  it("passes a refetch that works straight through", async () => {
    await expect(readBack(async () => "read")).resolves.toBeUndefined();
  });

  it("marks a failed refetch as the screen's, keeping the reason", async () => {
    const reason = new Error("401");
    await expect(readBack(async () => Promise.reject(reason))).rejects.toBeInstanceOf(
      StaleAfterWrite,
    );
    await expect(readBack(async () => Promise.reject(reason))).rejects.toHaveProperty(
      "reason",
      reason,
    );
  });
});

describe("every screen that logs a drop reads back through readBack", () => {
  // The drop bodies, not the URL: the four sites spell the path four ways (a template on a key, a
  // `lootUrl` built above, a bare literal), and matching on the path missed one of them.
  const logging = files.filter(
    (f) => /AddLootBody|LogDropBody/.test(f.text) && /method: "POST"/.test(f.text),
  );

  it("finds the call sites at all, so the guard cannot pass by finding none", () => {
    expect(logging.length).toBeGreaterThanOrEqual(4);
  });

  it.each(logging)("reads back through readBack in $file", ({ text }) => {
    expect(text).toMatch(/readBack\(/);
  });
});

describe("no drop picker is re-armed over a write that landed", () => {
  // Rethrowing out of onAdd is what keeps the picked drop on screen (see DropPicker), which is the
  // right thing for a refused write and the wrong thing for a stale list. The shape, not the
  // component: the Drop Log reaches the same picker through LogDrop and would not be found by name.
  const rethrowing = files.filter(
    (f) => f.text.includes("That didn't save.") && f.text.includes("throw e;"),
  );

  it("finds the pickers at all, so the guard cannot pass by finding none", () => {
    expect(rethrowing.length).toBeGreaterThanOrEqual(3);
  });

  it.each(rethrowing)("checks StaleAfterWrite before every rethrow in $file", ({ text }) => {
    // The CHECK, between the catch and the rethrow. Matching the bare name passed against a file
    // whose check had been deleted, because the import above it and the comment beside it both
    // still said it.
    for (let at = text.indexOf("throw e;"); at !== -1; at = text.indexOf("throw e;", at + 1)) {
      expect(text.slice(text.lastIndexOf("catch (", at), at)).toMatch(/instanceof StaleAfterWrite/);
    }
  });
});
