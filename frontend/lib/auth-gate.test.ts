import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// A page must not fetch before auth has answered.
//
// `getToken()` resolves null until the session is restored, and api.ts interpolates rather than
// refuses, so the whole mount burst goes out as `Bearer null` and every call 401s. One Party View
// load sent 45 of them and put "Couldn't load your parties." over data that was perfectly fine.
// It is a race, which means it passes by luck on a warm session and is not something a per-page
// test would reliably catch.
//
// The move off Clerk did not retire this. Tokens live 15 minutes now rather than 60 seconds, and
// lib/session-token.ts holds one rather than re-asking, so the window is narrower. Narrower is
// exactly what makes a race worth a guard instead of a memory: it now fails rarely enough to look
// like something else.
//
// Like read-back.test.ts, this guards a SHAPE across every page rather than one function, because
// the mistake is per-page and there are ten of them.

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

// The body of every useEffect in a file, roughly: from `useEffect(() => {` to the dedented `}, [`
// that closes it. Good enough to tell a fetch-on-mount from a click handler, which is all this
// needs to decide.
function effectBodies(text: string): string[] {
  const bodies: string[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i]?.includes("useEffect(() => {")) continue;
    const body: string[] = [];
    for (let j = i + 1; j < lines.length; j += 1) {
      if (/^\s{2}\}, \[/.test(lines[j] ?? "")) break;
      body.push(lines[j] ?? "");
    }
    bodies.push(body.join("\n"));
  }
  return bodies;
}

describe("no page fetches before auth has answered", () => {
  const fetchingOnMount = files.flatMap(({ file, text }) => {
    const bodies = effectBodies(text).filter(
      (body) => body.includes("getToken") || body.includes("apiFetch"),
    );
    return bodies.length > 0 ? [{ file, text, bodies }] : [];
  });

  // If this hits zero the scan has stopped finding anything and every assertion below passes
  // vacuously, which is the failure mode a source-scanning test has.
  it("finds the pages that fetch on mount", () => {
    expect(fetchingOnMount.length).toBeGreaterThanOrEqual(10);
  });

  it.each(fetchingOnMount.map(({ file }) => file))("%s waits for isLoaded", (file) => {
    const entry = fetchingOnMount.find((f) => f.file === file);

    expect(entry?.text).toContain("isLoaded");
    for (const body of entry?.bodies ?? []) {
      expect(body).toContain("if (!isLoaded) return;");
    }
  });
});
