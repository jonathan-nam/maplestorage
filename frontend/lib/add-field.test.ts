import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const components = join(__dirname, "..", "components");
// Comments quote the shape they are warning about, so a raw scan reads the warning as the bug.
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");
const field = strip(readFileSync(join(components, "add-field.tsx"), "utf8"));

// Field labels a box, and three screens deliberately want it OFF: DropPicker is carried by the
// party loot pool, Party View and the run plan as well as the Drop Log, and LootSaleForm is the
// pool row as well as the Sale Ledger's card. Those keep the rows they had.
//
// The switch is the whole of that, and it failed silently the first time. Written `on = true`, a
// caller passing `on={card}` for a `card?: boolean` it was never given passes `undefined`, which
// takes the DEFAULT: every opted-out screen quietly grew labels, and nothing about the change said
// so. Neither half of that is visible in a diff, so both are pinned here.
describe("the shared Field's switch", () => {
  it("has no default, so a missing prop cannot read as on", () => {
    expect(field).toMatch(/\bon:\s*boolean;/);
    expect(field, "`on` is defaulted again, which turns undefined into a label").not.toMatch(
      /\bon\s*=\s*(true|false)\b/,
    );
  });

  it("is handed a definite boolean by every caller", () => {
    const callers = readdirSync(components).filter((f) => f.endsWith(".tsx"));
    let checked = 0;
    for (const file of callers) {
      const src = strip(readFileSync(join(components, file), "utf8"));
      for (const call of src.matchAll(/<Field\s+on=\{([^}]*)\}/g)) {
        checked += 1;
        expect(
          call[1],
          `${file} passes \`on={${call[1]}}\`, which is undefined wherever the prop is not given`,
        ).toMatch(/^Boolean\(/);
      }
    }
    // A rename that stops matching would pass an empty loop, which is the test not running.
    expect(
      checked,
      "no conditional <Field on={...}> found; has the prop been renamed?",
    ).toBeGreaterThan(0);
  });
});
