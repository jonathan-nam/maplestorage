"""Re-cut the 6 token icon templates from a real screenshot.

The icons we started with came from the web prototype's assets. They work, but
they are not what the client actually draws -- Distorted Ambition only reaches
0.61 against a 0.55 threshold, and it is the first token to disappear once JPEG
artefacts are added. Templates lifted from the client's own rendering do not have
that gap.

Two regions of a slot must be excluded from the template's mask, or we would be
baking one screenshot's incidentals into the catalog:

  * the stack-count digits, which differ per screenshot, and
  * the cyan slot-lock bar along the bottom, which is per-SLOT state.

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
BOTTOM_BAR = 40  # rows below this carry the slot-lock bar

BG_LO, BG_HI = 214, 238  # the slot's flat grey backing

# The slot's raised border ridge, measured: 202..242, wider than the flat backing on both
# sides. Only the display mask uses this -- the matching mask deliberately keeps the tighter
# band, because there the ridge is a stable, identical feature of every slot and excluding it
# would cost correlation for nothing.
RIDGE_LO, RIDGE_HI = 200, 245
BG_FLAT = (226, 226, 226)  # the backing colour, for painting over the slot-lock bar


def _background(cell: np.ndarray) -> np.ndarray:
    """The slot's flat grey backing. Everything else is icon art."""
    grey = cv2.cvtColor(cell, cv2.COLOR_BGR2GRAY)
    hsv = cv2.cvtColor(cell, cv2.COLOR_BGR2HSV)
    return (grey >= BG_LO) & (grey <= BG_HI) & (hsv[:, :, 1] < 40)


def icon_mask(cell: np.ndarray) -> np.ndarray:
    """The mask used for MATCHING: the icon, minus anything that is not its identity.

    The count digits differ per screenshot, and the cyan bar along the bottom is the SLOT's
    state, not the item's: it marks a slot the player has locked against the in-game auto-sort.
    The same item is barred in one slot and bare in another, so both regions are cut out --
    otherwise we would bake one screenshot's incidentals into the catalog and an item would
    stop matching itself the moment the player locked its slot.
    """
    mask = (~_background(cell)).astype(np.uint8) * 255

    y0, y1, x0, x1 = DIGIT_ZONE
    mask[y0:y1, x0:x1] = 0
    mask[BOTTOM_BAR:, :] = 0

    # Drop speckle so the mask is the icon body, not stray antialiased pixels.
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
    return mask


def display_icon(cell: np.ndarray, font: dict) -> np.ndarray:
    """The icon as a picture for the UI -- a different job, and it needs the opposite mask.

    icon_mask() amputates the digit zone, which is right for matching and badly wrong here:
    an icon tall enough to reach the count band loses most of itself. The Extreme Blue Potion's
    seed asset was the potion's CAP and a stray fragment of slot corner -- alpha on 16% of its
    pixels -- and every elixir and potion in the catalog shipped like that. It is only the six
    original tokens, whose art happens to sit above the band, that looked right and hid it.

    So keep the whole icon, and remove the digits rather than the region they sit in. Their
    exact pixels are knowable -- we own the font and can find the glyphs -- so they are matched,
    masked and inpainted, and the art underneath is reconstructed instead of thrown away.

    The alpha is taken AFTER inpainting, which makes it self-correcting: a digit drawn over the
    backing inpaints to backing and drops out of the mask, while a digit drawn over the art
    inpaints to art and stays. The slot-lock bar is still dropped -- it is the slot's state,
    not the item's picture.
    """
    bgr = cell[:, :, :3].copy()

    # Flatten the slot-lock bar to the slot backing BEFORE inpainting. Not cosmetic:
    # INPAINT_TELEA reconstructs a hole from the colours around it, the digit zone runs right
    # down to the bar, and so every icon came out with a cyan smear along its bottom edge --
    # the bar leaking upward into the very pixels we were repairing. Masking the bar out
    # afterwards does not help, because by then its colour is already inside the artwork.
    bgr[BOTTOM_BAR:, :] = BG_FLAT

    # Where are the digits? Match the font over the count band, exactly as the reader does.
    y0, y1, x0, x1 = DIGIT_ZONE
    band = bgr[y0:y1, x0:x1]
    digits = np.zeros(band.shape[:2], np.uint8)
    for glyph in font.values():
        gh, gw = glyph.shape[:2]
        if gh > band.shape[0] or gw > band.shape[1]:
            continue
        m = cv2.cvtColor(glyph[:, :, 3], cv2.COLOR_GRAY2BGR)
        res = cv2.matchTemplate(band, glyph[:, :, :3], cv2.TM_CCOEFF_NORMED, mask=m)
        res[~np.isfinite(res)] = -1.0
        for gy, gx in zip(*np.where(res >= DISPLAY_DIGIT_THRESHOLD)):
            digits[gy : gy + gh, gx : gx + gw] |= glyph[:, :, 3] > 0

    ink = np.zeros(bgr.shape[:2], np.uint8)
    ink[y0:y1, x0:x1] = digits * 255
    # Dilate: the glyphs carry a dark outline and a drop shadow a pixel beyond their alpha,
    # and leaving that behind reads as dirt on the icon.
    ink = cv2.dilate(ink, np.ones((3, 3), np.uint8))
    if ink.any():
        bgr = cv2.inpaint(bgr, ink, 3, cv2.INPAINT_TELEA)

    # The slot's raised border ridge runs from about 202 to 242, straddling the matching
    # mask's 214-238 background band -- so its darker flanks read as "not background" and the
    # corner brackets of the slot were being cut out and shipped as part of the item. Widen the
    # band for display so the whole ridge falls inside it. The icons' own bright pixels are
    # near-white (250+) or saturated, and stay.
    grey = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    sat = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)[:, :, 1]
    chrome = (grey >= RIDGE_LO) & (grey <= RIDGE_HI) & (sat < 40)

    mask = (~chrome).astype(np.uint8) * 255
    mask[BOTTOM_BAR:, :] = 0
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
    # Close the pinholes the digits used to punch through the art.
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))

    rgba = cv2.merge([*cv2.split(bgr), mask])
    ys, xs = np.where(mask > 0)
    if len(xs) == 0:
        return rgba
    return rgba[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1]


# Lower than the reader's 0.60: a false positive here costs a few inpainted pixels, while a
# miss leaves a digit burned into the catalog's artwork forever.
DISPLAY_DIGIT_THRESHOLD = 0.45


class NotNativeScale(ValueError):
    """The source screenshot was rescaled, so its pixels are not the client's."""


def cut(img: np.ndarray, g, row: int, col: int, key: str) -> float:
    """Cut one template out of one slot. Returns the fraction of the slot the mask covers.

    This is the half of the pipeline that will eventually run when a user clicks "track
    this" on their own upload: they name a slot, and its pixels become the template every
    future screenshot is matched against. The mask is what makes that safe -- it excludes
    the stack-count digits and the slot-lock bar, which belong to *this* screenshot
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
