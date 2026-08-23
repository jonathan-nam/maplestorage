import { describe, expect, it } from "vitest";
import { type Click, startsNavigation } from "./nav-pending";

// A plain left click on an in-app link, from /bosses.
const click = (over: Partial<Click> = {}): Click => ({
  button: 0,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  href: "https://sharpeyes.app/bosses/parties",
  target: null,
  download: false,
  origin: "https://sharpeyes.app",
  pathname: "/bosses",
  ...over,
});

describe("clicks that are a page leaving", () => {
  it("is one for an in-app link to somewhere else", () => {
    expect(startsNavigation(click())).toBe(true);
  });

  it("is one for the pages reached from Party View", () => {
    // The ones that had no feedback at all before this existed.
    for (const href of ["/bosses/parties/abc-123", "/bosses/drops", "/bosses/parties/edit"]) {
      expect(startsNavigation(click({ href: `https://sharpeyes.app${href}` }))).toBe(true);
    }
  });
});

describe("clicks that are not", () => {
  it("ignores a click that was not on a link", () => {
    expect(startsNavigation(click({ href: null }))).toBe(false);
  });

  it("ignores the page it is already on", () => {
    // Nothing is fetched to replace it, so a bar would be claiming a wait that is not happening.
    expect(startsNavigation(click({ href: "https://sharpeyes.app/bosses" }))).toBe(false);
  });

  it("ignores a hash or a query on the current page", () => {
    // Same pathname, so it is a move WITHIN the page however different the URL looks.
    expect(startsNavigation(click({ href: "https://sharpeyes.app/bosses#top" }))).toBe(false);
    expect(startsNavigation(click({ href: "https://sharpeyes.app/bosses?week=2026-08-03" }))).toBe(
      false,
    );
  });

  it("ignores another site, and schemes that are not the web", () => {
    expect(startsNavigation(click({ href: "https://maplestory.io/api/thing" }))).toBe(false);
    expect(startsNavigation(click({ href: "mailto:someone@example.com" }))).toBe(false);
  });

  it("ignores a click that opens somewhere else", () => {
    // Each of these leaves THIS page exactly where it is, so dimming it would be a lie.
    expect(startsNavigation(click({ metaKey: true }))).toBe(false);
    expect(startsNavigation(click({ ctrlKey: true }))).toBe(false);
    expect(startsNavigation(click({ shiftKey: true }))).toBe(false);
    expect(startsNavigation(click({ altKey: true }))).toBe(false); // download, in most browsers
    expect(startsNavigation(click({ button: 1 }))).toBe(false); // middle click, new tab
    expect(startsNavigation(click({ target: "_blank" }))).toBe(false);
    expect(startsNavigation(click({ download: true }))).toBe(false);
  });

  it("still counts an explicit _self", () => {
    expect(startsNavigation(click({ target: "_self" }))).toBe(true);
  });

  it("refuses an href it cannot resolve rather than throwing", () => {
    expect(startsNavigation(click({ href: "not a url" }))).toBe(false);
  });
});
