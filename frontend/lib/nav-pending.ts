/**
 * Whether a click is one that leaves the page, and so is worth showing a wait for.
 *
 * Split out of the component because every condition here is a way to get it wrong quietly: a
 * miss shows nothing on a slow page, and a false positive dims a page that is not going anywhere.
 * See the tests.
 */

export type Click = {
  /** 0 for the main button. Anything else opens elsewhere or opens a menu. */
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  /** The anchor's resolved absolute href, or null when the click was not on one. */
  href: string | null;
  /** The anchor's target attribute. */
  target: string | null;
  download: boolean;
  /** Where the click happened. */
  origin: string;
  pathname: string;
};

export function startsNavigation(click: Click): boolean {
  // A modified click opens a tab or a window, and this page is staying put.
  if (click.button !== 0) return false;
  if (click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return false;

  if (click.href === null) return false;
  if (click.download) return false;
  if (click.target && click.target !== "_self") return false;

  let url: URL;
  try {
    url = new URL(click.href);
  } catch {
    // A href the browser could not resolve is not a route.
    return false;
  }

  // Another site, or a scheme that is not the web (mailto:, tel:). Neither is a route change this
  // app is about to render.
  if (url.origin !== click.origin) return false;

  // The page it is already on. A hash or a query is a move WITHIN the page, and nothing is being
  // fetched to replace it. Dimming for one would be the bar lying about what is happening.
  if (url.pathname === click.pathname) return false;

  return true;
}
