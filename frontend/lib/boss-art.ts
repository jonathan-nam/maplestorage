// GENERATED FROM catalog/bosses.yaml. DO NOT EDIT BY HAND.
// Regenerate with:  python catalog/build.py
//
// Two things that are known before a USER is, which is the whole reason they are shipped in the
// bundle rather than read off /api/bosses.
//
// BOSS_ART is backend-relative portrait paths, resolved with apiAssetUrl() like every other
// served asset. It exists so the browser can start fetching the portraits at first render rather
// than after getToken() and /api/bosses have both answered. That waterfall is what made the art
// appear a beat after the rest of the page.
//
// BOSS_NAMES is the display names, in catalog order. The Run Order tool has to offer a boss list
// with no account behind it, and deriving one from the keys gets "Kalos The Guardian" wrong.
//
// Only tracked bosses in both, matching what boss_catalog is seeded with.

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
  jupiter: "/boss-icons/jupiter.png",
  "black-mage": "/boss-icons/black-mage.png",
};

export const BOSS_NAMES: Record<string, string> = {
  lotus: "Lotus",
  damien: "Damien",
  "guardian-angel-slime": "Guardian Angel Slime",
  lucid: "Lucid",
  will: "Will",
  gloom: "Gloom",
  "verus-hilla": "Verus Hilla",
  darknell: "Darknell",
  "chosen-seren": "Chosen Seren",
  "kalos-the-guardian": "Kalos the Guardian",
  "first-adversary": "First Adversary",
  kaling: "Kaling",
  "malefic-star": "Malefic Star",
  limbo: "Limbo",
  baldrix: "Baldrix",
  jupiter: "Jupiter",
  "black-mage": "Black Mage",
};
