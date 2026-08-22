import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const css = readFileSync(join(root, "app", "globals.css"), "utf8");

// A `.page-title` is a line of text, so an image in one sits on the BASELINE: a 46px drop icon
// beside 20px words hung 16px above them, and the only gap between the two was whatever whitespace
// the JSX happened to carry (none, once JSX strips a newline). Both are invisible in review and
// obvious on screen, and neither is something the component can assert about itself.
//
// So this checks the sheet against the markup rather than checking the sheet alone: every image
// class that reaches a page title has to be in the rule that aligns them. A title that adds art
// under a new class fails here instead of shipping crooked.

/** Every .tsx under app/ and components/. */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sources(path);
    return entry.name.endsWith(".tsx") ? [path] : [];
  });
}

/** The class names on every `<img>` inside an `<h1 className="page-title">`. */
function artInTitles(): { file: string; className: string }[] {
  const found: { file: string; className: string }[] = [];
  for (const file of [...sources(join(root, "app")), ...sources(join(root, "components"))]) {
    const source = readFileSync(file, "utf8");
    for (const title of source.matchAll(/<h1 className="page-title"[^>]*>([\s\S]*?)<\/h1>/g)) {
      for (const img of title[1]!.matchAll(/<img[^>]*className="([^"]*)"/g)) {
        for (const name of img[1]!.split(/\s+/).filter(Boolean)) {
          found.push({ file: file.slice(root.length + 1), className: name });
        }
      }
    }
  }
  return found;
}

/** The selectors on the one rule that lifts title art off the baseline. */
const ALIGNED = (() => {
  const rule = css.match(/((?:\.page-title \.[a-z-]+,?\s*)+)\{([^}]*)\}/);
  if (!rule) return { selectors: [] as string[], body: "" };
  return {
    selectors: [...rule[1]!.matchAll(/\.page-title \.([a-z-]+)/g)].map((m) => m[1]!),
    body: rule[2]!,
  };
})();

describe("art in a page title", () => {
  it("is centred on the words and spaced off them", () => {
    expect(ALIGNED.body).toMatch(/vertical-align:\s*middle/);
    expect(ALIGNED.body).toMatch(/margin-right:\s*\d+px/);
  });

  it("covers every image the titles actually carry", () => {
    const art = artInTitles();
    // Guard the guard: a regex that stopped matching would pass this file silently.
    expect(art.length).toBeGreaterThan(0);
    for (const { file, className } of art) {
      expect(ALIGNED.selectors, `${file} puts .${className} in a page title`).toContain(className);
    }
  });
});
