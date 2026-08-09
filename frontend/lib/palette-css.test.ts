import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");

// The shell palette is slate rather than grey, which means every surface is LIGHTER than the
// near-black it replaced. That is the whole risk of the change: a foreground that cleared its
// background comfortably at #111 can quietly fall under the readable floor at #23282e without
// anything erroring. Three of them did (--muted, --muted-2, --bad) and were lifted. This pins the
// floor so the next palette edit cannot undo that silently.
const FLOOR = 4.5;

const SURFACES = ["--bg", "--surface", "--surface-2"] as const;
const FOREGROUNDS = [
  "--ink",
  "--ink-strong",
  "--muted",
  "--muted-2",
  "--accent",
  "--good",
  "--warn",
  "--bad",
] as const;

const TOKENS: ReadonlyMap<string, string> = (() => {
  const root = /:root\s*\{([\s\S]*?)\n\}/.exec(css);
  if (!root?.[1]) throw new Error("no :root block in globals.css");
  const out = new Map<string, string>();
  for (const [, name, value] of root[1].matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{3,6});/g)) {
    if (name && value) out.set(name, value);
  }
  return out;
})();

function token(name: string): string {
  const value = TOKENS.get(name);
  if (!value) throw new Error(`${name} is not defined in :root`);
  return value;
}

function channels(name: string): [number, number, number] {
  const hex = token(name).slice(1);
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
  const at = (i: number) => parseInt(full.slice(i, i + 2), 16);
  return [at(0), at(2), at(4)];
}

// WCAG 2.x relative luminance.
function luminance(name: string): number {
  const [r, g, b] = channels(name).map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

describe("shell palette stays readable", () => {
  it("defines every token the shell is built from", () => {
    for (const name of [...SURFACES, ...FOREGROUNDS]) {
      expect(TOKENS.get(name), `${name} missing from :root`).toMatch(/^#[0-9a-fA-F]{3,6}$/);
    }
  });

  for (const fg of FOREGROUNDS) {
    for (const bg of SURFACES) {
      it(`${fg} on ${bg} clears ${FLOOR}:1`, () => {
        expect(contrast(fg, bg)).toBeGreaterThanOrEqual(FLOOR);
      });
    }
  }

  // Only that the surfaces stay distinct, not that the step is legible on its own: it is not.
  // At 7/255 the --surface to --surface-2 step is below what the eye reads unaided, which is why
  // the boss-table bands use hue instead (see the comment on that rule) and why cards are
  // separated by --line. This guards the weaker property, that a future edit does not collapse
  // two surfaces into the same colour and silently erase the ladder.
  it("keeps each surface distinct from the one below it", () => {
    for (let i = 0; i < SURFACES.length - 1; i++) {
      const lower = SURFACES[i];
      const upper = SURFACES[i + 1];
      if (!lower || !upper) throw new Error("surface ladder is not contiguous");
      const below = channels(lower);
      const above = channels(upper);
      const step = Math.max(...above.map((c, j) => c - (below[j] ?? 0)));
      expect(step, `${lower} -> ${upper}`).toBeGreaterThanOrEqual(6);
    }
  });

  // Slate is the point of the palette. A future edit that flattens it back to neutral grey would
  // pass every contrast check above and lose the whole reason for the change.
  it("keeps the surfaces on the game's blue-grey, not neutral grey", () => {
    for (const name of SURFACES) {
      const [r, , b] = channels(name);
      expect(b - r, `${name} is not slate`).toBeGreaterThanOrEqual(6);
    }
  });
});
