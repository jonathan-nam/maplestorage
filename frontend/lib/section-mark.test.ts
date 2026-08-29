import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MARK_DROP } from "@/components/section-mark";

// The Drop tab's mark is a catalog drop looked up by key, so the key has to keep naming one. Drop
// it from the catalog and the tab holds an empty box instead, which nothing else would report.
// The frontend CI filter lists this file's input for the same reason: a check that stops running
// is a check that stopped.
const yaml = readFileSync(join(__dirname, "..", "..", "catalog", "drops.yaml"), "utf8");

describe("the mark on the Drop Ledger's tab", () => {
  it("names a drop the catalog defines", () => {
    expect(yaml).toContain(`- key: ${MARK_DROP}\n`);
  });

  it("names one that is on a boss's table, which is where the page reads it from", () => {
    // /api/bosses/drops is keyed by boss, so a drop on nobody's table never reaches the page.
    const tables = yaml.slice(yaml.indexOf("\ntables:"));
    expect(tables).toContain(`- ${MARK_DROP}\n`);
  });
});
