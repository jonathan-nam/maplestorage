"""Build the two kinds of picture we keep of an item, from the client's own pixels.

They are different jobs and they want opposite things from the same slot:

  * The MATCHING template (`--cut`, `templates/token-<key>.png`) is the item's IDENTITY. The
    stack-count digits and the cyan slot-lock bar belong to one screenshot rather than to the
    item, so both are masked out -- otherwise an item would stop matching itself the moment its
    count changed or the player locked its slot.

  * The DISPLAY icon (`--display`, the backend's seed-assets) is the item's PICTURE. It needs
    the digits and the bar gone too, but everything else kept -- including the art *underneath*
    them, which a single screenshot never captured. That art is recovered by compositing across
    captures rather than invented; see composite_display_icon().

Both must be cut from a NATIVE-scale capture. Parsing tolerates a rescaled screenshot, but
authoring from one bakes a blurred guess into the catalog forever -- see cut().

    python -m app.cv.build_icons <shot.png> --cut kalos-token=r7c12 ...
    python -m app.cv.build_icons --display <shot.png> <shot2.png> ...
"""

import re
import sys
from pathlib import Path

import cv2
import numpy as np

from .grid import NATIVE_PITCH, find_grid
from .match import find_tokens, load_templates
from .ocr import load_font

TEMPLATE_DIR = Path(__file__).parent / "templates"

# Slot-relative regions to keep out of the mask (native 46px slot).
DIGIT_ZONE = (26, 41, 0, 41)  # y0, y1, x0, x1 -- where counts are drawn
BOTTOM_BAR = 40  # rows below this carry the slot-lock bar

BG_LO, BG_HI = 214, 238  # the slot's flat grey backing

# The slot's raised border ridge lives in the outermost ring of pixels. The display mask drops
# it by position, not by brightness -- see _cut_out(). The icon art does not reach the very
# edge, so this costs nothing.
BORDER = 2

# An icon is one connected shape (plus, sometimes, a detached sparkle or a ring segment worth
# keeping). Anything smaller than this is slot noise rather than art, and it reads as dirt
# floating next to the item in the inventory grid.
MIN_ISLAND = 12
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


def _occluded(cell: np.ndarray, font: dict) -> np.ndarray:
    """Which pixels of this slot are hidden by something that is not the item.

    Two things cover the art: the stack-count digits, and the slot-lock bar. Both belong to
    this screenshot rather than to the item, and neither can be seen through.
    """
    bgr = cell[:, :, :3]
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

    occ = np.zeros(bgr.shape[:2], np.uint8)
    occ[y0:y1, x0:x1] = digits
    # The glyphs carry a dark outline and a drop shadow a pixel beyond their own alpha, and
    # leaving that behind reads as dirt on the icon.
    occ = cv2.dilate(occ, np.ones((3, 3), np.uint8))
    occ[BOTTOM_BAR:, :] = 1
    return occ.astype(bool)


MAX_SHIFT = 3  # px; the grid origin is never further out than this


def _shift(a: np.ndarray, dy: int, dx: int) -> np.ndarray:
    out = np.zeros_like(a)
    ys, yd = (slice(dy, 46), slice(0, 46 - dy)) if dy >= 0 else (slice(0, 46 + dy), slice(-dy, 46))
    xs, xd = (slice(dx, 46), slice(0, 46 - dx)) if dx >= 0 else (slice(0, 46 + dx), slice(-dx, 46))
    out[yd, xd] = a[ys, xs]
    return out


def _best_shift(ref: np.ndarray, other: np.ndarray, both_visible: np.ndarray) -> tuple[int, int]:
    """Integer offset that best registers `other` onto `ref`, judged only where both are art."""
    best, best_d = None, (0, 0)
    for dy in range(-MAX_SHIFT, MAX_SHIFT + 1):
        for dx in range(-MAX_SHIFT, MAX_SHIFT + 1):
            m = _shift(both_visible.astype(np.float32), dy, dx) > 0.5
            if m.sum() < 200:
                continue
            d = float(np.abs(_shift(other, dy, dx)[m] - ref[m]).mean())
            if best is None or d < best:
                best, best_d = d, (dy, dx)
    return best_d


def composite_display_icon(cells: list[np.ndarray], font: dict) -> np.ndarray:
    """One item's true artwork, assembled from every slot we have ever seen it in.

    The stack count is drawn ON TOP of the icon, so the pixels beneath it were never captured
    and cannot be recovered from a single screenshot. The previous version inpainted them --
    reconstructing plausible art from the surrounding colours -- and it looked like exactly
    what it was: a guess, soft and smeared across the bottom-left of every tall icon.

    But the same item turns up in several captures with DIFFERENT counts, and a different count
    hides different pixels. A '1' covers five columns; a '2655' covers forty. Cernium appears as
    1, 340, 786 and 2655. So instead of inventing the hidden pixels, take them from a capture
    where they are not hidden: for each pixel, the median of every instance in which it is
    visible. Nothing is imagined, and the median also averages away JPEG noise.

    Measured over the corpus, the number of pixels still hidden in EVERY instance falls to 45
    (Cernium) - 317 (Vanishing Journey, whose counts are all four digits and so always cover the
    same place) out of the 1840 above the bar. Only those get inpainted.

    Returns the FULL 46x46 slot, not a crop: the icon's position within the slot is part of how
    the client draws it, and the UI now renders these 1:1 at the client's own slot size.
    """
    # ALIGN FIRST. The grid origin is only good to a pixel or two, and it lands differently in
    # each screenshot, so the same icon sits at a slightly different offset in each cell. Taking
    # a median of misregistered copies does not average noise away, it smears the artwork -- it
    # punched holes clean through kalos-token and left half the catalog blotchy. So register
    # every instance against the least-occluded one before combining them.
    occs = [_occluded(c, font) for c in cells]
    ref_i = int(np.argmin([o.sum() for o in occs]))
    ref = cells[ref_i][:, :, :3].astype(np.float32)

    aligned, visible = [], []
    for cell, occ in zip(cells, occs):
        bgr = cell[:, :, :3].astype(np.float32)
        dy, dx = _best_shift(ref, bgr, ~occ & ~occs[ref_i])
        aligned.append(_shift(bgr, dy, dx))
        visible.append(_shift((~occ).astype(np.float32), dy, dx) > 0.5)

    stack = np.stack(aligned)
    visible = np.stack(visible)

    seen = visible.any(axis=0)
    out = np.zeros((46, 46, 3), np.float32)
    # Per-pixel median over the instances where the pixel is visible. Done by masking the
    # hidden ones to NaN so they take no part in the statistic.
    masked = np.where(visible[:, :, :, None], stack, np.nan)
    with np.errstate(invalid="ignore"):
        med = np.nanmedian(masked, axis=0)
    out[seen] = med[seen]
    out[~seen] = BG_FLAT
    bgr = out.astype(np.uint8)

    # Whatever no capture ever showed us -- reconstruct, but now it is a handful of pixels
    # rather than the whole count band.
    hole = (~seen).astype(np.uint8)
    hole[BOTTOM_BAR:, :] = 0  # the bar is not a hole in the art; there is simply nothing there
    if hole.any():
        bgr = cv2.inpaint(bgr, hole, 3, cv2.INPAINT_TELEA)

    return _cut_out(bgr)


def _cut_out(bgr: np.ndarray) -> np.ndarray:
    """Alpha the slot backing away, leaving the item on transparency. Full 46x46, uncropped."""
    grey = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    sat = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)[:, :, 1]
    chrome = (grey >= BG_LO) & (grey <= BG_HI) & (sat < 40)

    mask = (~chrome).astype(np.uint8) * 255
    mask[BOTTOM_BAR:, :] = 0
    mask[:BORDER, :] = 0
    mask[-BORDER:, :] = 0
    mask[:, :BORDER] = 0
    mask[:, -BORDER:] = 0
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))

    n, labels, stats, _ = cv2.connectedComponentsWithStats((mask > 0).astype(np.uint8), 8)
    if n > 1:
        keep = np.zeros_like(mask)
        biggest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
        for i in range(1, n):
            if i == biggest or stats[i, cv2.CC_STAT_AREA] >= MIN_ISLAND:
                keep[labels == i] = 255
        mask = keep

    return cv2.merge([*cv2.split(bgr), mask])


def build_display_icons(capture_paths: list[str], out_dir: Path) -> dict[str, int]:
    """Regenerate every seed icon the UI shows, from every capture we have.

    Kept separate from cut(), which builds the MATCHING template, because the two want opposite
    things from the same slot. The matcher wants the item's identity, so it throws away the count
    digits and the slot-lock bar. The UI wants the item's picture, so it needs them gone but
    everything else kept -- including the art underneath them.

    Returns {key: number of slot instances it was built from}.
    """
    # Imported here rather than at module scope: match.py imports this module, and classify is
    # only needed for the offline regeneration path.
    from .classify import classify

    templates = load_templates()
    font = load_font()

    instances: dict[str, list[np.ndarray]] = {}
    for path in capture_paths:
        img = cv2.imread(path)
        if img is None:
            raise FileNotFoundError(path)
        g = find_grid(img)
        if abs(g.pitch - NATIVE_PITCH) > 0.5:
            raise NotNativeScale(f"{path}: pitch {g.pitch:.1f}, not native -- see cut()")
        for hit in classify(img, g, templates):
            x, y, w, _ = g.cell(hit.row, hit.col)
            cell = img[y : y + w, x : x + w]
            if cell.shape[:2] == (int(NATIVE_PITCH), int(NATIVE_PITCH)):
                instances.setdefault(hit.name, []).append(cell)

    out_dir.mkdir(parents=True, exist_ok=True)
    for key, cells in instances.items():
        cv2.imwrite(str(out_dir / f"{key}.png"), composite_display_icon(cells, font))
    return {k: len(v) for k, v in instances.items()}


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


SEED_ASSETS = Path(__file__).resolve().parents[3] / (
    "backend/src/main/resources/seed-assets/tokens"
)


def main():
    # `--display <capture>...` regenerates the seed icons the UI shows, from every capture
    # given. Every item in the catalog must appear in at least one of them.
    if "--display" in sys.argv:
        i = sys.argv.index("--display")
        caps = [a for a in sys.argv[i + 1 :] if not a.startswith("-")]
        if not caps:
            print("--display needs at least one screenshot")
            return 1
        built = build_display_icons(caps, SEED_ASSETS)
        missing = set(load_templates()) - set(built)
        for k in sorted(built):
            print(f"  {k:<26} composited from {built[k]} slot(s)")
        if missing:
            print(f"\n  no capture contains: {sorted(missing)} -- their icons are unchanged")
            return 1
        print(f"\nwrote {len(built)} icons to {SEED_ASSETS}")
        return 0

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
