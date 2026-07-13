"""Read a slot's stack-count by matching the client's digit font.

Tesseract scores 2/12 on these counts -- an 11px proportional bitmap font drawn
over arbitrary icon art is nothing like the scanned text it is trained for. But
the font is fixed and, thanks to the grid, we know the exact scale, so the counts
are better read by correlating the ten known glyphs directly.

Each glyph carries an alpha mask covering only its own pixels, so the icon art
showing through behind the digits does not enter the correlation. Candidates are
then resolved left to right, keeping the best-scoring non-overlapping run.
"""

import glob
import os
from pathlib import Path

import cv2
import numpy as np

from .grid import NATIVE_PITCH, Grid

TEMPLATE_DIR = Path(__file__).parent / "templates"

BAND_TOP, BAND_BOT = 25, 41  # digit band within a native-scale (46px) slot
DIGIT_THRESHOLD = 0.60
JITTER = 2  # px of slack when looking for the next digit's left edge

# A glyph must also land on the count's actual outline pixels. Correlation alone
# lets the 8px '4' sit on top of the 5px '1' and score higher than '1' does
# ("1482" -> "4482"); requiring its outline to coincide with the dark pixels that
# are really there rules that out.
#
# "Dark" is taken relative to each band's own contrast rather than as a fixed
# cutoff: a capture that has been through a rescale has a softened outline, and a
# hard threshold throws every one of its digits away.
MIN_OUTLINE_AGREEMENT = 0.75
OUTLINE_FRACTION = 0.45  # of the band's own intensity range


def load_font(path: str | Path = TEMPLATE_DIR) -> dict:
    font = {}
    for f in sorted(glob.glob(os.path.join(str(path), "digit_*.png"))):
        d = os.path.basename(f)[len("digit_") : -len(".png")]
        im = cv2.imread(f, cv2.IMREAD_UNCHANGED)
        if im is None or im.shape[2] != 4:
            raise ValueError(f"{f}: expected an RGBA glyph")
        font[d] = im
    if len(font) != 10:
        raise ValueError(f"expected 10 digits, got {sorted(font)}")
    return font


def _outline_of(glyph: np.ndarray) -> np.ndarray:
    grey = cv2.cvtColor(glyph[:, :, :3], cv2.COLOR_BGR2GRAY)
    return (grey <= 80) & (glyph[:, :, 3] > 0)


# The band is taken with a margin, and the margin is not cosmetic.
#
# The stack count is drawn at the slot's bottom-LEFT, hard against the edge, and the grid
# origin is only accurate to about a pixel: JPEG re-encoding moved it by one at q=92 and q=85
# while leaving it alone at q=95 and q=75. Cropping the band exactly at the cell boundary
# meant that one-pixel shift sliced the leftmost column off the digits -- fatal for a '1'
# that is only 5px wide.
#
# The symptom was baffling and worth recording: correlation collapsed from 0.995 to 0.41, but
# only at q=92 and q=85, and only on some slots. Quality does not behave like that, and it
# sent me looking for numerical instability in matchTemplate that was never there. The digits
# were always perfectly legible. We were reading the wrong pixels.
#
# A couple of pixels of slack costs nothing -- matchTemplate slides, so a wider band simply
# gives it more room -- and it makes the read immune to the grid being a pixel out.
BAND_MARGIN = 3


def cell_band(img: np.ndarray, g: Grid, row: int, col: int) -> np.ndarray:
    """The count band of one slot, resampled to native scale, with a margin for grid jitter."""
    x, y, w, h = g.cell(row, col)
    cell = img[max(y, 0) : y + h, max(x, 0) : x + w]
    if cell.size == 0:
        return cell

    n = int(NATIVE_PITCH)
    scale = n / max(w, 1)
    if cell.shape[0] != n or cell.shape[1] != n:
        cell = cv2.resize(cell, (n, n), interpolation=cv2.INTER_CUBIC)

    # Widen leftwards in the ORIGINAL image, then rescale, so the margin is real pixels
    # rather than interpolated edge.
    m = int(round(BAND_MARGIN / max(scale, 1e-6)))
    x0 = max(x - m, 0)
    strip = img[max(y, 0) : y + h, x0 : x + w]
    if strip.size and strip.shape[1] > w:
        target_w = int(round(strip.shape[1] * scale))
        strip = cv2.resize(strip, (target_w, n), interpolation=cv2.INTER_CUBIC)
        return strip[BAND_TOP:BAND_BOT]

    return cell[BAND_TOP:BAND_BOT]


def read_count(img: np.ndarray, g: Grid, row: int, col: int, font: dict) -> tuple[str, float]:
    """Return (digits, mean confidence). Empty string if no count is drawn."""
    band = cell_band(img, g, row, col)
    if band.size == 0:
        return "", 0.0

    grey = cv2.cvtColor(band, cv2.COLOR_BGR2GRAY).astype(np.float32)
    lo, hi = float(grey.min()), float(grey.max())
    dark = grey <= lo + OUTLINE_FRACTION * (hi - lo)

    # Best score for each glyph at each x, plus the y it occurred at (the font's
    # y-offset is fixed, so collapsing over y loses nothing).
    best = {}
    for d, glyph in font.items():
        gh, gw = glyph.shape[:2]
        if gh > band.shape[0] or gw > band.shape[1]:
            continue
        mask = cv2.cvtColor(glyph[:, :, 3], cv2.COLOR_GRAY2BGR)
        res = cv2.matchTemplate(band, glyph[:, :, :3], cv2.TM_CCOEFF_NORMED, mask=mask)
        res[~np.isfinite(res)] = -1.0
        best[d] = (res.max(axis=0), res.argmax(axis=0))

    def agreement(d: str, x: int) -> float:
        """Fraction of the glyph's outline that lands on real outline pixels."""
        y = int(best[d][1][x])
        o = _outline_of(font[d])
        h, w = o.shape
        sub = dark[y : y + h, x : x + w]
        if sub.shape != o.shape:
            return 0.0
        return float((o & sub).sum()) / max(int(o.sum()), 1)

    # Decode left to right, advancing by the width of whatever we just accepted.
    # A plain non-max suppression is not enough here: '1' is only 5px wide and
    # correlates well with the vertical stroke *inside* a '0', so "10" reads as
    # "101" unless accepting the '0' also consumes the span it covers.
    chosen = []
    x, width = 0, band.shape[1]
    while x < width:
        pick = None
        for dx in range(JITTER + 1):
            xi = x + dx
            for d, (scores, _) in best.items():
                if xi >= len(scores) or scores[xi] < DIGIT_THRESHOLD:
                    continue
                if agreement(d, xi) < MIN_OUTLINE_AGREEMENT:
                    continue
                if pick is None or scores[xi] > pick[2]:
                    pick = (xi, d, float(scores[xi]))
        if pick is None:
            x += 1
            continue
        px, d, s = pick
        chosen.append((px, d, s))
        x = px + font[d].shape[1] - 1

    if not chosen:
        return "", 0.0
    digits = "".join(d for _, d, _ in chosen)
    conf = float(np.mean([s for _, _, s in chosen]))
    return digits, conf
