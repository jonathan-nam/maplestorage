import { useEffect } from "react";
import type { Party } from "@/types/party";

/** Every distinct seat sprite in a list of parties. A character in four parties is one URL. */
export function seatSpriteUrls(parties: Party[]): string[] {
  const urls = new Set<string>();
  for (const party of parties) {
    for (const member of party.members) {
      if (member.spriteImgUrl) urls.add(member.spriteImgUrl);
    }
  }
  return [...urls];
}

// Fetched once per document. Nexon serves the sprites with no cache headers at all, so what a warm
// buys is the renderer's own memory cache: it holds across the app's client-side navigations, and
// a full page load onto a party pays for them again.
const warmed = new Set<string>();

/**
 * Start the seat sprites downloading while the party list is being read.
 *
 * Only the party page draws them, and it cannot name them until it has fetched the party, so the
 * first click on a party whose members are new paints an empty seat frame for as long as the sprite
 * takes. The list is holding the same URLs already, so the fetch can start a click early.
 *
 * `new Image()` and not the `preload` of lib/preload-boss-art.ts, which would be the obvious
 * neighbour: both were measured to spare the second request, but a `<link rel=preload>` the page
 * itself never draws is warned about in the console once a few seconds pass, and the click it is
 * waiting for may never come. An effect for the same reason, rather than during render: these
 * belong to the next page, so they wait behind this one's own painting.
 */
export function useSeatSprites(parties: Party[]): void {
  useEffect(() => {
    for (const url of seatSpriteUrls(parties)) {
      if (warmed.has(url)) continue;
      warmed.add(url);
      new Image().src = url;
    }
  }, [parties]);
}
