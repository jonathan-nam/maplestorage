// What the hamburger lists, and which entry a path belongs to.
//
// Split out of the component because the highlight rule has a silent failure mode: a path that
// resolves to the wrong entry does not error, it just lights the wrong word. See the tests.

export type SectionItem = {
  href: string;
  label: string;
  /**
   * In the menu's routing but not on its list.
   *
   * A page reached from inside another section rather than from the hamburger. It still has to be
   * MATCHED, or the longest-match rule below falls back to a shorter href and lights up a section
   * the page is not in: /bosses/people would otherwise resolve to /bosses and read as
   * "Individual View".
   */
  hidden?: boolean;
};

/**
 * A group is a heading with its own links, NOT a link itself: there is no /bossing page, and a
 * heading that navigated nowhere would be the one thing in here that lies about what it does.
 *
 * /characters redirects to /inventory (see next.config), so old links keep working.
 *
 * The Wallet, the Drop Log and People are deliberately absent from the list. They are reached from
 * Party View and its editor, which is where you already are when you want them, and six entries
 * under one heading had stopped being a menu and started being a list of every page.
 */
export const SECTIONS: { group?: string; items: SectionItem[] }[] = [
  { items: [{ href: "/inventory", label: "Inventory" }] },
  {
    group: "Bossing",
    items: [
      { href: "/bosses", label: "Individual View" },
      { href: "/bosses/parties", label: "Party View" },
      // Reached from the party editor, so it needs matching but not listing. The Wallet and the
      // Drop Log need neither: they sit under /bosses/parties and so already resolve to Party
      // View, which is the section they are part of.
      { href: "/bosses/people", label: "People", hidden: true },
      { href: "/bosses/split", label: "Split Utility" },
    ],
  },
];

/** Every href the menu routes, hidden ones included. */
export const HREFS = SECTIONS.flatMap((s) => s.items.map((i) => i.href));

/** Only what is on the list. Prefetching a page the menu cannot reach would warm nothing. */
export const MENU_HREFS = SECTIONS.flatMap((s) =>
  s.items.filter((i) => !i.hidden).map((i) => i.href),
);

/**
 * Which entry to light up for this path, or undefined for none.
 *
 * Longest match wins, so /bosses/split lights "Split Utility" alone: a plain startsWith would
 * light "Individual View" too, since one section nests under the other. A hidden href can win,
 * and then nothing is highlighted, which is the point of it winning.
 */
export function activeHref(pathname: string): string | undefined {
  return HREFS.filter((href) => pathname === href || pathname.startsWith(`${href}/`)).sort(
    (a, b) => b.length - a.length,
  )[0];
}
