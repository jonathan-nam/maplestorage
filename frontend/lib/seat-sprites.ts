import { useEffect } from "react";
import { spriteUrl } from "@/lib/api";
import type { Party } from "@/types/party";

/**
 * Every distinct seat sprite in a list of parties. A character in four parties is one URL.
 *
 * Resolved through spriteUrl, because what the API sends is backend-relative: assigning the bare
 * path to an <img> would warm a URL on the frontend's own origin, which is a 404 in dev and in prod
 * both.
 */
export function seatSpriteUrls(parties: Party[]): string[] {
  const urls = new Set<string>();
  for (const party of parties) {
    for (const member of party.members) {
      if (member.spriteImgUrl) urls.add(spriteUrl(member.spriteImgUrl));
    }
  }
  return [...urls];
}

// The warmed sprites, held rather than fetched and forgotten.
//
// This used to be the whole trick, back when these were Nexon URLs: they came with no cache headers
// at all, so a warm landed in the renderer's memory cache and was evicted at leisure. Measured in
// headless Chrome against the real URLs: an <img> asking 5 seconds later got it free, one asking 60
// seconds later paid again, and one asking with the element still referenced got it free.
//
// They are our own paths now (see lib/api.ts spriteUrl), served immutable for a year, so the HTTP
// cache does that job and survives a reload as well. The hold stays for the one case it does not
// cover: a sprite whose bytes have not been fetched yet redirects to Nexon as no-store, and that
// one is uncacheable exactly as before.
//
// Bounded by the characters in your parties, at 96x96 each. A full page load starts over.
const held = new Map<string, HTMLImageElement>();

/**
 * Start the seat sprites downloading while the party list is being read.
 *
 * A seat is drawn on opening a row here and on the party page, so nothing asks for a sprite until a
 * click, and a character you have not seen paints an empty frame for as long as the download takes.
 * The list is holding the URLs already, so it can start a click early.
 *
 * `new Image()` and not the `preload` of lib/preload-boss-art.ts, which would be the obvious
 * neighbour: both spare the second request, but a `<link rel=preload>` the page has not drawn yet
 * is warned about in the console once a few seconds pass, and the click it is waiting for may never
 * come. An effect rather than during render for the same reason: nothing on screen is waiting.
 */
export function useSeatSprites(parties: Party[]): void {
  useEffect(() => {
    for (const url of seatSpriteUrls(parties)) {
      if (held.has(url)) continue;
      const img = new Image();
      img.src = url;
      held.set(url, img);
    }
  }, [parties]);
}
