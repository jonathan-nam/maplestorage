import { preload } from "react-dom";
import { apiAssetUrl } from "./api";
import { BOSS_ART } from "./boss-art";

// Start the portraits downloading at first render.
//
// Without this they cannot begin until getToken() and /api/bosses have both answered, because
// that is when their URLs first exist: the page shell paints immediately and the art arrives a
// beat later. The paths are build-time data (catalog/bosses.yaml), so nothing about them needs a
// signed-in user, and preloading them costs 16 requests of about 1.2 KB that the page is going to
// make anyway.
//
// Call during render, not in an effect: an effect runs after paint, which is most of the delay
// this is meant to remove. `preload` de-duplicates, so calling it on every render is free.
export function preloadBossArt(): void {
  for (const path of Object.values(BOSS_ART)) {
    preload(apiAssetUrl(path), { as: "image" });
  }
}
