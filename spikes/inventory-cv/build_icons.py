"""Re-cut the 6 token icon templates from a real screenshot.

The icons we started with came from the web prototype's assets. They work, but
they are not what the client actually draws -- Distorted Ambition only reaches
0.61 against a 0.55 threshold, and it is the first token to disappear once JPEG
artefacts are added. Templates lifted from the client's own rendering do not have
that gap.

Two regions of a slot must be excluded from the template's mask, or we would be
baking one screenshot's incidentals into the catalog:

  * the stack-count digits, which differ per screenshot, and
  * the cyan "untradeable" bar along the bottom, which is per-item state.

Run against a screenshot holding all six tokens; writes templates/token-*.png.
"""

import sys

import cv2
import numpy as np

from grid import NATIVE_PITCH, find_grid
from match import find_tokens, load_templates

# Slot-relative regions to keep out of the mask (native 46px slot).
DIGIT_ZONE = (26, 41, 0, 41)  # y0, y1, x0, x1 -- where counts are drawn
BOTTOM_BAR = 40  # rows below this carry the untradeable bar

BG_LO, BG_HI = 214, 238  # the slot's flat grey backing


def icon_mask(cell: np.ndarray) -> np.ndarray:
    grey = cv2.cvtColor(cell, cv2.COLOR_BGR2GRAY)
    hsv = cv2.cvtColor(cell, cv2.COLOR_BGR2HSV)

    # Background = flat, unsaturated grey. Everything else is icon art.
    background = ((grey >= BG_LO) & (grey <= BG_HI) & (hsv[:, :, 1] < 40))
    mask = (~background).astype(np.uint8) * 255

    y0, y1, x0, x1 = DIGIT_ZONE
    mask[y0:y1, x0:x1] = 0
    mask[BOTTOM_BAR:, :] = 0

    # Drop speckle so the mask is the icon body, not stray antialiased pixels.
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
    return mask


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else "../../reference-images/inventory sample.png"
    img = cv2.imread(path)
    if img is None:
        print(f"cannot read {path}")
        return 1

    g = find_grid(img)
    if abs(g.pitch - NATIVE_PITCH) > 0.5:
        print(f"refusing to cut templates from a rescaled screenshot (pitch {g.pitch:.1f})")
        return 1

    # Bootstrap from the prototype artwork -- using the game-cut templates here
    # would just re-find whatever we cut last time.
    hits = find_tokens(img, g, load_templates(prefer_game_cut=False))
    print(f"{path}: located {len(hits)}/6 tokens with the prototype icons\n")

    for h in hits:
        x, y, w, _ = g.cell(h.row, h.col)
        cell = img[y : y + w, x : x + w]
        mask = icon_mask(cell)
        rgba = cv2.merge([*cv2.split(cell), mask])
        cv2.imwrite(f"templates/token-{h.token}.png", rgba)
        print(f"  {h.token:24s} r{h.row}c{h.col}  mask covers {(mask > 0).mean() * 100:4.1f}% of slot")
    return 0


if __name__ == "__main__":
    sys.exit(main())
