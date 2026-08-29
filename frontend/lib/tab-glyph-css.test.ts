import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");

// The Drop Log's three drawn marks are one set, and a set is one weight. The check shipped with a
// stroke of its own because a lone check looks thin next to a dollar sign, which is true and is
// also how an icon set stops being one: it measured 2.25px against the other two at 1.91px. Colour
// is the only thing a variant is allowed to change, so the base is the only rule that may weigh it.
describe("the drawn stage marks", () => {
  const rules = [...css.matchAll(/(\.tab-glyph[^{]*)\{([^}]*)\}/g)].map((m) => ({
    selector: m[1]!.trim(),
    body: m[2]!,
  }));

  it("has a base rule that sets the weight", () => {
    const base = rules.find((r) => r.selector === ".tab-glyph");
    expect(base, "no .tab-glyph rule in globals.css").toBeDefined();
    expect(base!.body).toMatch(/stroke-width:/);
  });

  it("lets no single glyph weigh itself differently", () => {
    const heavier = rules
      .filter((r) => r.selector !== ".tab-glyph" && /stroke-width:/.test(r.body))
      .map((r) => r.selector);
    expect(
      heavier,
      `${heavier.join(", ")} sets its own stroke-width. One weight for the set, on .tab-glyph.`,
    ).toEqual([]);
  });
});
