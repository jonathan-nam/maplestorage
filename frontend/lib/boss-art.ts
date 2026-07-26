// GENERATED FROM catalog/bosses.yaml. DO NOT EDIT BY HAND.
// Regenerate with:  python catalog/build.py
//
// Backend-relative paths, resolved with apiAssetUrl() like every other served asset. This exists
// for ONE reason: the portraits are known before a user is, so the browser can start fetching
// them at first render rather than after getToken() and /api/bosses have both answered. That
// waterfall is what made the art appear a beat after the rest of the page.
//
// Only tracked bosses, matching what boss_catalog is seeded with.

export const BOSS_ART: Record<string, string> = {
  lotus: "/boss-icons/lotus.png",
  damien: "/boss-icons/damien.png",
  "guardian-angel-slime": "/boss-icons/guardian-angel-slime.png",
  lucid: "/boss-icons/lucid.png",
  will: "/boss-icons/will.png",
  gloom: "/boss-icons/gloom.png",
  "verus-hilla": "/boss-icons/verus-hilla.png",
  darknell: "/boss-icons/darknell.png",
  "chosen-seren": "/boss-icons/chosen-seren.png",
  "kalos-the-guardian": "/boss-icons/kalos-the-guardian.png",
  "first-adversary": "/boss-icons/first-adversary.png",
  kaling: "/boss-icons/kaling.png",
  "malefic-star": "/boss-icons/malefic-star.png",
  limbo: "/boss-icons/limbo.png",
  baldrix: "/boss-icons/baldrix.png",
  "black-mage": "/boss-icons/black-mage.png",
};
