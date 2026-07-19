import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");

// These files explain this machinery in prose, so an assertion against the raw source matches the
// comment describing the thing rather than the thing. Both of these tests passed against the
// comment alone when first written.
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const layoutRaw = readFileSync(join(root, "app", "layout.tsx"), "utf8");
const layout = stripComments(layoutRaw);
const header = stripComments(readFileSync(join(root, "components", "site-header.tsx"), "utf8"));
const css = readFileSync(join(root, "app", "globals.css"), "utf8");

// The header's space reservation is spread across three files that have to agree on two class
// names, and every way it breaks is silent. A renamed class does not error, the reservation just
// stops happening and the brand shifts 54px again when Clerk resolves, which is the bug this
// machinery exists to prevent and which nothing else would catch.
describe("header control reservation", () => {
  // The selector and class assertions below match to a boundary, not a prefix. `toContain` on the
  // bare name passes against `.header-reservedX`, so a rename in one file only would have slipped
  // through the exact test written to catch it.
  it("sets the class the CSS gates on", () => {
    expect(layout).toContain('classList.add("has-session")');
    expect(css).toMatch(/html:not\(\.has-session\)\s+\.header-reserved\s*\{/);
  });

  it("marks the boxes with the class the CSS hides", () => {
    // Both controls reserve: the hamburger and the avatar.
    expect(header.match(/header-reserved(?![\w-])/g)?.length).toBe(2);
  });

  it("reads the cookie Clerk actually sets", () => {
    expect(layout).toContain("__client_uat");
  });

  // Runs the string that actually ships, pulled out of layout.tsx, against a stand-in document.
  // A copy of the regex here would pass while the shipped one was wrong, which is the whole risk:
  // this script cannot throw a visible error, it can only reserve when it should not or fail to
  // when it should, and both look like a header that shifts.
  describe("the shipped cookie check", () => {
    const source = /const RESERVE_CONTROLS = `([\s\S]*?)`;/.exec(layoutRaw)?.[1];
    // The source text carries TypeScript's escaping (`\\s`); undo one level to get what runs.
    const run = (cookie: string) => {
      const classes: string[] = [];
      const doc = {
        cookie,
        documentElement: { classList: { add: (c: string) => classes.push(c) } },
      };
      new Function("document", (source ?? "").replace(/\\\\/g, "\\"))(doc);
      return classes.includes("has-session");
    };

    it("was found in layout.tsx", () => expect(source).toBeTruthy());

    it.each([
      ["", false, "no cookies"],
      ["__client_uat=0", false, "signed out, explicit 0"],
      ["__client_uat=", false, "empty value"],
      ["__client_uat=1752000000", true, "a session"],
      ["foo=1; __client_uat=1752000000", true, "after another cookie"],
      ["foo=1;__client_uat=1752000000", true, "after another cookie, unspaced"],
      // The two that would silently over-reserve: a cookie whose name merely ENDS with the one we
      // want, and our name appearing inside someone else's value.
      ["my__client_uat=1752000000", false, "name is a suffix of another"],
      ["foo=__client_uat=9", false, "inside another cookie's value"],
    ])("%s -> reserve=%s (%s)", (cookie, want) => {
      expect(run(cookie as string)).toBe(want);
    });
  });

  it("keeps the routes prerenderable", () => {
    // The whole point of moving the read into the browser. A cookies() call here opts every route
    // into dynamic rendering, which also drops the client router's staleTime to 0 so no navigation
    // can be served from cache. Reintroducing it would undo that invisibly: the build still
    // succeeds and the pages still work, they are just all dynamic again.
    expect(layout).not.toContain("next/headers");
    expect(layout).not.toContain("cookies()");
  });
});
