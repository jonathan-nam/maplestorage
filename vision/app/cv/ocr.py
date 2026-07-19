"""Read a slot's stack-count by matching the client's digit font.

Tesseract scores 2/12 on these counts, an 11px proportional bitmap font drawn
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

from .grid import Grid

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

# When two glyphs in one jitter window score within this of each other, the LEFTMOST wins
# rather than the higher-scoring one. Digits run left to right, so a glyph further right
# cannot be this same digit, but only a near-tie licenses overriding the score.
#
# Both ends are measured. A blurred Parsec '0' scored 0.641 at x=50 against an '8' at 0.648
# four pixels on, and the 0.007 gap read "20" as "28"; blur fills the '0' counter until
# correlation genuinely cannot tell them apart. On a native capture the same pairing is not
# close at all, the '8' of "187" scores 0.993 against a '0' 0.709 one pixel left, and
# ranking THAT by position reads "107". 0.05 sits in the gap between 0.007 and 0.284.
NEAR_TIE = 0.05


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
# meant that one-pixel shift sliced the leftmost column off the digits. Fatal for a '1'
# that is only 5px wide.
#
# The symptom was baffling and worth recording: correlation collapsed from 0.995 to 0.41, but
# only at q=92 and q=85, and only on some slots. Quality does not behave like that, and it
# sent me looking for numerical instability in matchTemplate that was never there. The digits
# were always perfectly legible. We were reading the wrong pixels.
#
# A couple of pixels of slack costs nothing, matchTemplate slides, so a wider band simply
# gives it more room, and it makes the read immune to the grid being a pixel out.
BAND_MARGIN = 3


def scale_font(font: dict, scale: float) -> dict:
    """The digit glyphs at the capture's scale."""
    if abs(scale - 1.0) < 0.01:
        return font
    return {
        d: cv2.resize(g, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
        for d, g in font.items()
    }


def cell_band(img: np.ndarray, g: Grid, row: int, col: int) -> np.ndarray:
    """The count band of one slot, AT THE CAPTURE'S OWN SCALE, with a margin for grid jitter.

    This used to resample the band down to the native 46px and match native glyphs against
    it. That is backwards, and it is the single reason a rescaled capture was unreadable: the
    count font is 11px, so on a capture that arrived at 1.33x we were taking the ~15px digits
    we had actually been given and squeezing them back to 11px before trying to read them.
    Destroying, in the last step before the decision, exactly the evidence the decision needed.
    Measured on a real Parsec frame: nothing legible that way; all five counts correct when the
    band is left alone and the glyphs are scaled up to meet it.
    """
    x, y, w, h = g.cell(row, col)
    m = max(int(round(BAND_MARGIN * g.scale)), BAND_MARGIN)
    top = y + int(round(BAND_TOP * g.scale)) - m
    bot = y + int(round(BAND_BOT * g.scale)) + m
    return img[max(top, 0) : bot, max(x - m, 0) : x + w]


# Oversampling factor for the correlation, on a capture that is not at native scale.
#
# matchTemplate slides in WHOLE pixels. At native that is fine, because the glyph and the
# digit were drawn on the same pixel grid and line up exactly. On a rescaled capture they no
# longer do: the digit lands on some arbitrary sub-pixel phase, the glyph can only be tried at
# integer offsets, and on a 9px-wide '0' half a pixel of misalignment is a large fraction of
# the glyph. The damage is erratic rather than progressive, which is what makes it so
# confusing to chase, the '0' of a stack of 10 scored 0.83 at 1.25x and 0.59 at 1.1x, the
# GENTLER rescale, purely because 1.1x happened to land it on a worse phase.
#
# Enlarging the band and the glyph together by 3 lets the correlation slide in thirds of a
# captured pixel. It invents no information, both sides are interpolated identically, so
# this is a finer search, not a sharper image, and it lifts the worst case measured across
# 1.1x / 1.25x / 1.326x / 1.5x / 1.75x from 0.591 (below the 0.60 bar, digit silently dropped)
# to 0.710. K=4 buys another 0.003, which is not worth the time.
#
# Native captures skip this entirely: they already score ~0.94 and there is nothing to fix.
OVERSAMPLE = 3


def read_count(img: np.ndarray, g: Grid, row: int, col: int, font: dict) -> tuple[str, float]:
    """Return (digits, mean confidence). Empty string if no count is drawn."""
    chosen, _ = _decode(img, g, row, col, font)
    if not chosen:
        return "", 0.0
    return "".join(d for _, d, _, _ in chosen), float(np.mean([s for _, _, s, _ in chosen]))


def count_spans(img: np.ndarray, g: Grid, row: int, col: int, font: dict) -> list[tuple[int, int]]:
    """Where the count's glyphs sit in the slot, as (x, width) in the slot's own pixels.

    Exists so build_icons can blank the count out of an icon without re-deriving where it is.
    Deriving it separately is exactly what kept going wrong, a second, slacker glyph matcher
    fires on the artwork, and the answer must not be allowed to disagree with the number we
    actually report. Same decode, same gates, one source of truth.
    """
    chosen, k = _decode(img, g, row, col, font)
    x0 = max(int(round(BAND_MARGIN * g.scale)), BAND_MARGIN)
    # `chosen` is in the band's own (possibly oversampled) coordinates, and the band starts
    # x0 to the LEFT of the cell. Bring both back to slot pixels.
    return [(int(round(x / k)) - x0, int(round(w / k))) for x, _, _, w in chosen]


def _decode(img: np.ndarray, g: Grid, row: int, col: int, font: dict):
    """The shared decode. Returns ([(x, digit, score, width)], scale) in band coordinates."""
    band = cell_band(img, g, row, col)
    if band.size == 0:
        return [], 1.0

    k = g.scale
    if abs(k - 1.0) >= 0.01:
        k *= OVERSAMPLE
        band = cv2.resize(band, None, fx=OVERSAMPLE, fy=OVERSAMPLE, interpolation=cv2.INTER_CUBIC)
    font = scale_font(font, k)

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
    #
    # JITTER is quoted in NATIVE pixels and must be converted into whatever units this band is
    # measured in, which is not the same thing on a rescaled, oversampled capture. Forgetting
    # that produced a genuinely misleading bug: the window that hunts for the next digit's
    # left edge shrank to two thirds of a real pixel, the '0' of "x10" peaked just outside it,
    # and the '8' (which peaks slightly earlier and was still inside) was accepted in its
    # place. It read 18. Nothing was wrong with the correlation (the '0' beat the '8' 0.87 to
    # 0.64 at its own position); we simply never looked where the '0' was.
    jitter = max(int(round(JITTER * k)), 1)
    chosen = []
    x, width = 0, band.shape[1]
    while x < width:
        cands = []
        for dx in range(jitter + 1):
            xi = x + dx
            for d, (scores, _) in best.items():
                if xi >= len(scores) or scores[xi] < DIGIT_THRESHOLD:
                    continue
                if agreement(d, xi) < MIN_OUTLINE_AGREEMENT:
                    continue
                cands.append((xi, d, float(scores[xi])))
        if not cands:
            x += 1
            continue
        # Best score in the window, then the leftmost candidate that ties with it. See NEAR_TIE.
        top = max(s for _, _, s in cands)
        pick = min(
            (c for c in cands if c[2] >= top - NEAR_TIE),
            key=lambda c: (c[0], -c[2]),
        )
        px, d, s = pick
        chosen.append((px, d, s, font[d].shape[1]))
        # Advance past what we just took, less ONE NATIVE PIXEL of slack, the glyphs' boxes
        # are a touch wider than the font's true advance, so consuming the full width steps
        # over the start of the next digit. That slack is a native-pixel quantity like JITTER,
        # and hard-coding it as a bare 1 is what actually caused the "x10" -> "18" misread: the
        # advance overshot the '0' (which sat 16 units on) by three, landing in the middle of
        # it, where the only glyph still scoring was '8'.
        x = px + font[d].shape[1] - max(int(round(k)), 1)

    return chosen, k
