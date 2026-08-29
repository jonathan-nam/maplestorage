import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Four sizes and two weights, pinned. The scale is only worth having if a fifth size costs
// something, and a stylesheet this size drifts a px at a time with nobody noticing. These tests are
// the cost.
const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");

// Comments quote declarations they are explaining, so a raw scan reads those as real rules.
const code = css.replace(/\/\*[\s\S]*?\*\//g, "");

type Rule = { selector: string; body: string };

function rules(): Rule[] {
  const out: Rule[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    out.push({ selector: (m[1] ?? "").trim(), body: m[2] ?? "" });
  }
  return out;
}

describe("the type scale", () => {
  it("defines exactly four steps", () => {
    const defined = [...code.matchAll(/--text-([a-z]+):\s*(\d+)px;/g)].map((m) => m[1]);
    expect(defined.sort()).toEqual(["base", "lg", "sm", "xl"]);
  });

  it("is the only source of a font size, outside the game window", () => {
    // The inventory window replicates the client at a measured 12/18. Rounding it to our scale
    // would be rounding away the thing it exists to copy, so it keeps its own numbers.
    const raw = rules()
      .filter((r) => !r.selector.includes(".ms-"))
      .filter((r) => /font-size:\s*\d/.test(r.body))
      .map((r) => r.selector);
    expect(raw).toEqual([]);
  });

  it("has no step nobody uses", () => {
    for (const step of ["sm", "base", "lg", "xl"]) {
      expect(code).toContain(`font-size: var(--text-${step})`);
    }
  });
});

describe("bolding", () => {
  it("is one weight, not a gradient of four", () => {
    // 600 and 700 were both in use for the same job, picked per rule rather than per meaning.
    const weights = new Set(
      [...code.matchAll(/font-weight:\s*([^;]+);/g)].map((m) => (m[1] ?? "").trim()),
    );
    expect([...weights].sort()).toEqual(["400", "600"]);
  });
});

describe("the tiny-caps header", () => {
  it("is gone, and stays gone", () => {
    expect(code).not.toMatch(/text-transform:\s*uppercase/);
  });

  it("took its letter-spacing with it", () => {
    // Six different tracking values, none of which was a decision. Nothing left needs any.
    expect(code).not.toMatch(/letter-spacing:/);
  });
});

describe("the corner scale", () => {
  it("defines three steps and a pill", () => {
    const defined = [...code.matchAll(/--radius-([a-z]+):/g)].map((m) => m[1]);
    expect(defined.sort()).toEqual(["lg", "md", "pill", "sm"]);
  });

  it("is the only source of a single-value radius, outside the game window", () => {
    // Same exemption as the type scale, plus .sk-slot: it is the placeholder for .ms-slot, and a
    // placeholder whose corner does not match the slot replacing it is a flicker, not a saving.
    const raw = rules()
      .filter((r) => !/\.ms-|\.sk-slot/.test(r.selector))
      .filter((r) => /border-radius:\s*\d+px;/.test(r.body))
      .map((r) => r.selector);
    expect(raw).toEqual([]);
  });

  it("keeps the pill for states, not for labels and counts", () => {
    // A pill is a claim that the thing is a status you scan a column for. Eight chips were wearing
    // one to mean "this is a chip", which is what the shape stopped being able to say.
    const pills = rules()
      .filter((r) => r.body.includes("var(--radius-pill)"))
      .map((r) => r.selector)
      .sort();
    expect(pills).toEqual([
      ".ledger-bar",
      ".loot-paid",
      ".loot-status",
      ".party-clear",
      ".run-pool",
    ]);
  });
});
