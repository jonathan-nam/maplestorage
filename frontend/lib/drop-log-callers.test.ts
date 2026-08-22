import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// buildDropLog decides whether a coupon is still owed, and it can only be right if it is handed the
// settlements: `owedBy` is `entitled - looted`, fixed when the drop was logged, so without them a
// closed debt reads as owed for ever. See V52.
//
// This is a guard against the mistake rather than the mistake: the closures were added to two call
// sites and missed on a third, twice, because each one names its arguments differently and a search
// for the exact call did not reach them. Nothing a unit test on the function itself can catch, since
// the parameter has a default and every call type-checks without it.

const root = join(__dirname, "..");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !name.includes(".test.") ? [path] : [];
  });
}

/** The argument list of one call, by matching parentheses rather than counting commas. */
function argsOf(text: string, from: number): string {
  let depth = 0;
  for (let i = from; i < text.length; i += 1) {
    if (text[i] === "(") depth += 1;
    if (text[i] === ")") {
      depth -= 1;
      if (depth === 0) return text.slice(from, i);
    }
  }
  return text.slice(from);
}

describe("every caller of buildDropLog hands it the settlements", () => {
  const calls = sources(join(root, "app")).flatMap((file) => {
    const text = readFileSync(file, "utf8");
    const out: { file: string; args: string }[] = [];
    for (
      let i = text.indexOf("buildDropLog(");
      i !== -1;
      i = text.indexOf("buildDropLog(", i + 1)
    ) {
      out.push({
        file: file.slice(root.length + 1),
        args: argsOf(text, i + "buildDropLog".length),
      });
    }
    return out;
  });

  it("finds the call sites at all, so the guard cannot pass by finding none", () => {
    expect(calls.length).toBeGreaterThanOrEqual(3);
  });

  it.each(calls)("passes closures in $file", ({ args }) => {
    // Named either way at the call sites in hand. What matters is that something was passed.
    expect(args).toMatch(/closed|closures/);
  });

  // The same guard for the other half of "this night is finished". A closure is a decision somebody
  // made; a tranche is a sale that answered the coupons with money. Miss either and the badge asks
  // for a debt that is not owed, which is how this one was found: two weeks of Extreme Kalos coupons
  // billed again a week after they were sold and offset. See V56.
  it.each(calls)("passes the answered tranches in $file", ({ args }) => {
    expect(args).toMatch(/answeredByPair|answered/);
  });
});

// The same guard one argument along, on the list rather than what finishes a night.
//
// buildDropLog and outstanding both skip a pool whose config they were not handed, so a page that
// fetches only the STANDING configs and all the pools drops those nights silently. That is not just
// a row missing: a coupon debt cancels against the other nights with the same person and a sale
// answers them in the order they fell, both across every party at once, so leaving one out moves
// the figure on the parties that are still on the list. Party View asked for 10 coupons the Drop
// Log had already washed against a retired config's night.
//
// A page may still draw only the standing ones. It has to ASK for all of them.
describe("every page that reads a pool as a ledger fetches every config", () => {
  const LEDGERS = ["buildDropLog(", "outstanding("];
  const pages = sources(join(root, "app")).flatMap((file) => {
    const text = readFileSync(file, "utf8");
    const called = LEDGERS.filter((fn) => text.includes(fn));
    return called.length > 0 ? [{ file: file.slice(root.length + 1), text, called }] : [];
  });

  it("finds the pages at all, so the guard cannot pass by finding none", () => {
    expect(pages.length).toBeGreaterThanOrEqual(3);
  });

  it.each(pages)("asks for the retired configs in $file", ({ text }) => {
    expect(text).toContain("retired=include");
  });

  // Solo pools for the same reason. A config taken back as one keeps the nights it was a party for,
  // and those weeks have a pinned roster with somebody else in it. See soloAgain.
  it.each(pages)("asks for the solo pools in $file", ({ text }) => {
    expect(text).toContain("solo=include");
  });
});
