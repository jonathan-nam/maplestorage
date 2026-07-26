import { describe, expect, it } from "vitest";
import { activeHref, HREFS, MENU_HREFS, SECTIONS } from "./section-menu";

const labelFor = (pathname: string) =>
  SECTIONS.flatMap((s) => s.items).find((i) => i.href === activeHref(pathname))?.label;

describe("which section a path belongs to", () => {
  it("lights the entry for its own page", () => {
    expect(labelFor("/inventory")).toBe("Inventory");
    expect(labelFor("/bosses")).toBe("Individual View");
    expect(labelFor("/bosses/parties")).toBe("Party View");
    expect(labelFor("/bosses/split")).toBe("Split Utility");
  });

  it("keeps a nested section off its parent", () => {
    // The rule the longest-match sort exists for: /bosses/split must not also light the entry for
    // /bosses, which is a prefix of it.
    expect(labelFor("/bosses/split")).not.toBe("Individual View");
    expect(labelFor("/bosses/parties")).not.toBe("Individual View");
  });

  it("lights Party View for the pages that hang off it", () => {
    // The Wallet and the Drop Log are no longer listed in the menu. They still belong to Party
    // View, and living under its path is what makes them read that way with no entry of their own.
    expect(labelFor("/bosses/parties/wallet")).toBe("Party View");
    expect(labelFor("/bosses/parties/drops")).toBe("Party View");
    expect(labelFor("/bosses/parties/edit")).toBe("Party View");
    expect(labelFor("/bosses/parties/abc-123")).toBe("Party View");
  });

  it("does NOT light Individual View for People", () => {
    // The trap this file is here for. People was dropped from the menu; without a hidden entry
    // holding its path, the longest match falls back to /bosses and the hamburger claims you are
    // on Individual View. Nothing errors, it just says something untrue.
    expect(activeHref("/bosses/people")).toBe("/bosses/people");
    expect(labelFor("/bosses/people")).not.toBe("Individual View");
  });

  it("has nothing to light for a path outside every section", () => {
    expect(activeHref("/upload")).toBeUndefined();
    expect(activeHref("/")).toBeUndefined();
  });
});

describe("what the menu lists", () => {
  it("leaves the pages reached from Party View off the list", () => {
    expect(MENU_HREFS).not.toContain("/bosses/parties/wallet");
    expect(MENU_HREFS).not.toContain("/bosses/parties/drops");
    expect(MENU_HREFS).not.toContain("/bosses/people");
  });

  it("still routes the hidden ones", () => {
    // Listed and routed are different sets, and the hidden entry has to stay in the second.
    expect(HREFS).toContain("/bosses/people");
    expect(HREFS.length).toBeGreaterThan(MENU_HREFS.length);
  });

  it("lists the four sections a person navigates between", () => {
    expect(MENU_HREFS).toEqual(["/inventory", "/bosses", "/bosses/parties", "/bosses/split"]);
  });
});
