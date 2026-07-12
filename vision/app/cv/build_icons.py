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

import re
import sys
from pathlib import Path

import cv2
import numpy as np

from .grid import NATIVE_PITCH, find_grid
from .match import find_tokens, load_templates

TEMPLATE_DIR = Path(__file__).parent / "templates"

# Slot-relative regions to keep out of the mask (native 46px slot).
DIGIT_ZONE = (26, 41, 0, 41)  # y0, y1, x0, x1 -- where counts are drawn
BOTTOM_BAR = 40  # rows below this carry the untradeable bar

BG_LO, BG_HI = 214, 238  # the slot's flat grey backing


def icon_mask(cell: np.ndarray) -> np.ndarray:
    grey = cv2.cvtColor(cell, cv2.COLOR_BGR2GRAY)
    hsv = cv2.cvtColor(cell, cv2.COLOR_BGR2HSV)

    # Background = flat, unsaturated grey. Everything else is icon art.
    background = (grey >= BG_LO) & (grey <= BG_HI) & (hsv[:, :, 1] < 40)
    mask = (~background).astype(np.uint8) * 255

    y0, y1, x0, x1 = DIGIT_ZONE
    mask[y0:y1, x0:x1] = 0
    mask[BOTTOM_BAR:, :] = 0

    # Drop speckle so the mask is the icon body, not stray antialiased pixels.
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
    return mask


class NotNativeScale(ValueError):
    """The source screenshot was rescaled, so its pixels are not the client's."""


def cut(img: np.ndarray, g, row: int, col: int, key: str) -> float:
    """Cut one template out of one slot. Returns the fraction of the slot the mask covers.

    This is the half of the pipeline that will eventually run when a user clicks "track
    this" on their own upload: they name a slot, and its pixels become the template every
    future screenshot is matched against. The mask is what makes that safe -- it excludes
    the stack-count digits and the untradeable bar, which belong to *this* screenshot
    rather than to the item.

    The source MUST be at the client's native scale, and that is a correctness requirement
    rather than a nicety. Parsing tolerates a rescaled capture -- the catalog is scaled up to
    meet it -- but AUTHORING from one poisons the catalog permanently, because a template is
    supposed to be the client's own pixels and a rescaled one is a blurred guess at them.

    Measured, on the Grandis tokens, cutting from a real 1.326x Parsec capture and scoring
    against a native screenshot: 0.84-0.91, where the client-cut template scores 1.000. That
    is barely over the 0.80 verify bar, and it is fatal for items that come in families. Cut
    from that capture, the Arcane and Sacred Symbols matched the WRONG symbol (0.87) better
    than they matched themselves (0.85) -- the classifier would not have failed to identify
    them, it would have confidently identified them as each other.

    This matters most for the user-facing "track this item" flow, where the screenshot is
    whatever the user happened to upload. Refusing here is the difference between one user
    being told to send a better screenshot and every user silently getting wrong counts.
    """
    if abs(g.pitch - NATIVE_PITCH) > 0.5:
        raise NotNativeScale(
            f"slot pitch is {g.pitch:.1f}px, not the client's native {NATIVE_PITCH:.0f}px -- "
            "this screenshot has been rescaled, so its pixels are not the client's and a "
            "template cut from it would be a blur. Templates must come from a native-scale "
            "capture (MapleStory's own in-game screenshot always is, even over remote play)."
        )
    x, y, w, _ = g.cell(row, col)
    cell = img[y : y + w, x : x + w]
    mask = icon_mask(cell)
    rgba = cv2.merge([*cv2.split(cell), mask])
    cv2.imwrite(str(TEMPLATE_DIR / f"token-{key}.png"), rgba)
    return float((mask > 0).mean())


def main():
    # `--cut key=rXcY ...` cuts named slots; with no --cut, re-cuts the 6 known tokens by
    # finding them, which is what this script originally did.
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    cuts = []
    if "--cut" in sys.argv:
        i = sys.argv.index("--cut")
        for spec in sys.argv[i + 1 :]:
            if spec.startswith("-"):
                break
            key, _, ref = spec.partition("=")
            m = re.fullmatch(r"r(\d+)c(\d+)", ref)
            if not key or not m:
                print(f"bad --cut spec {spec!r}; want key=rXcY")
                return 1
            cuts.append((key, int(m.group(1)), int(m.group(2))))
            args = [a for a in args if a != spec]

    path = args[0] if args else "../../reference-images/inventory sample.png"
    img = cv2.imread(path)
    if img is None:
        print(f"cannot read {path}")
        return 1

    g = find_grid(img)

    if cuts:
        print(f"{path}: cutting {len(cuts)} template(s)\n")
        try:
            for key, r, c in cuts:
                cover = cut(img, g, r, c, key)
                print(f"  {key:24s} r{r}c{c}  mask covers {cover * 100:4.1f}% of slot")
        except NotNativeScale as e:
            # The check lives in cut() rather than here, so that it also guards the
            # "track this item" flow, which will call cut() without coming through this CLI.
            print(f"refusing to cut: {e}")
            return 1
        return 0

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
        print(
            f"  {h.token:24s} r{h.row}c{h.col}  mask covers {(mask > 0).mean() * 100:4.1f}% of slot"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
