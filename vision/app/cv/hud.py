"""Read the character HUD ("Lv.287 acornacorn") from a screenshot.

This is a different problem from the stack counts, and it wants the opposite
tool. The counts are an 11px bitmap font over icon art, where Tesseract scores
2/12 and matching the client's own glyphs scores 100%. The HUD is ~20px
anti-aliased proportional text on a dark plate -- ordinary rendered text, which
is exactly what Tesseract is for. It reads the raw crop exactly, and every
binarisation we tried made it *worse* ("acornacom", "Lv.28/7"), so we feed it
the pixels as they are.

Glyph templates are not an option here anyway: a name is an arbitrary IGN, so
the alphabet is ~62 glyphs, and we have exactly one HUD sample containing five
distinct letters. There is nothing to build a font from.

Locating the HUD is the part classical CV does well. The HUD is anchored to the
*game window*, not the screenshot, so its position moves. But the client draws
"Lv." at a fixed pixel size, so we find it by matching that prefix and read the
line that follows.
"""

import re
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

TEMPLATE = Path(__file__).parent / "templates" / "hud-lv.png"

# Correlation below this is not the "Lv." prefix. The HUD sits on whatever the
# game world happens to be behind it, so the template carries an alpha mask and
# only the glyph pixels are correlated.
MATCH_THRESHOLD = 0.60

# The name follows "Lv." on the same baseline. Offsets are relative to the
# matched prefix, in native (unscaled) client pixels. LINE_LEFT matters: a crop
# flush against the "L" clips its left stem and Tesseract reads it as a "t".
LINE_LEFT = 4
LINE_UP, LINE_DOWN = 6, 18
LINE_RIGHT = 175

# The prefix is already confirmed by the template match, so this only has to pull
# the level and name back out -- it tolerates a garbled "Lv" rather than rejecting
# a HUD we have positively identified.
#
# The name is bounded by CHARSET, not by "everything to the end of the line". That
# is the whole fix for a real bug: LINE_RIGHT is a fixed 175px crop, wide enough for
# the longest IGN, so on a SHORT name it overruns into the HUD icons sitting beside
# it and Tesseract reads them as trailing glyphs. `acornacorn` came back as
# `acornacorn?. ©` and got saved as a character by that name.
#
# A MapleStory IGN is alphanumeric -- no spaces, no punctuation, no symbols. So
# anything outside [A-Za-z0-9] is, by construction, not part of the name: stop there
# rather than trying to guess where the crop should have ended. Widening the crop
# would still overrun on a 4-character name; narrowing it would truncate a
# 12-character one. The charset is the only boundary that holds for both.
HUD_RE = re.compile(r"^\W*[A-Za-z]{1,2}\.?\s*(\d{1,3})\s+([A-Za-z0-9]{2,13})")


@dataclass
class Hud:
    name: str
    level: int
    score: float


# Tesseract is trained on scanned text at ~300dpi. The HUD line is about 24px tall at
# native scale, which is far below what it expects, and at that size "rn" simply does
# not have the pixels to stay distinct from "m". A real upload came back as
# `acornacorm` and the app created a character by that name.
#
# Upscaling the crop before OCR fixes it outright. Measured on the reference screenshot
# rendered at every capture scale we support:
#
#     crop as-is (24px)   1.25x capture -> "acornacom"   WRONG
#     crop at 64px        every scale   -> "acornacorn"  correct
#
# This is not a tweak that happened to help. The failure only appears where the line is
# small, and it disappears at every scale once the line is big enough to read.
TARGET_LINE_HEIGHT = 64


def _tesseract(img: np.ndarray) -> str:
    k = TARGET_LINE_HEIGHT / img.shape[0]
    if k > 1.0:
        # CUBIC, not LANCZOS: on text this size LANCZOS rings around the strokes.
        img = cv2.resize(img, None, fx=k, fy=k, interpolation=cv2.INTER_CUBIC)

    with tempfile.NamedTemporaryFile(suffix=".png") as f:
        cv2.imwrite(f.name, img)
        out = subprocess.run(
            ["tesseract", f.name, "stdout", "--psm", "7"],
            capture_output=True,
            text=True,
            timeout=15,
        )
    return out.stdout.strip()


# Sliding a masked template over the whole frame is expensive: 763ms on a 2359x1095
# screenshot, which was 45% of the entire parse -- more than every other stage put
# together. The mask is what costs; the same match without one runs in 211ms.
#
# So search a quarter-scale copy first and only refine the winner at full resolution.
# 13x faster, and it lands on the identical pixel.
#
# The coarse pass can be wrong, and the design assumes it: the refined score is checked
# against the same threshold as before, and anything that fails falls back to the full
# frame. So the fast path is an optimisation, never a new way to be wrong. (Empirically
# 1/2 and 1/4 both land exactly; 1/3 misses badly -- a 25x18 template does not survive
# an odd rescale. Powers of two only, and the fallback catches the rest.)
COARSE_FACTOR = 4
REFINE_PAD = 2 * COARSE_FACTOR


def _match(img: np.ndarray, tpl: np.ndarray) -> tuple[float, tuple[int, int]]:
    mask = cv2.cvtColor(tpl[:, :, 3], cv2.COLOR_GRAY2BGR)
    res = cv2.matchTemplate(img, tpl[:, :, :3], cv2.TM_CCOEFF_NORMED, mask=mask)
    res[~np.isfinite(res)] = -1.0
    _, score, _, loc = cv2.minMaxLoc(res)
    return float(score), loc


def _locate(img: np.ndarray, tpl: np.ndarray) -> tuple[float, tuple[int, int]] | None:
    """Where the "Lv." prefix is, or None if it isn't in frame."""
    th, tw = tpl.shape[:2]
    f = COARSE_FACTOR

    # Only worth the two-pass dance if the coarse template survives the downscale.
    if img.shape[0] // f > th and img.shape[1] // f > tw and min(th, tw) // f >= 4:
        small = cv2.resize(img, None, fx=1 / f, fy=1 / f, interpolation=cv2.INTER_AREA)
        small_tpl = cv2.resize(tpl, None, fx=1 / f, fy=1 / f, interpolation=cv2.INTER_AREA)
        _, (cx, cy) = _match(small, small_tpl)

        x0 = max(cx * f - REFINE_PAD, 0)
        y0 = max(cy * f - REFINE_PAD, 0)
        x1 = min(x0 + tw + 2 * REFINE_PAD, img.shape[1])
        y1 = min(y0 + th + 2 * REFINE_PAD, img.shape[0])
        window = img[y0:y1, x0:x1]

        if window.shape[0] > th and window.shape[1] > tw:
            score, (rx, ry) = _match(window, tpl)
            if score >= MATCH_THRESHOLD:
                return score, (x0 + rx, y0 + ry)

    # Coarse pass missed, or the image is too small to bother. Do it properly.
    score, loc = _match(img, tpl)
    return (score, loc) if score >= MATCH_THRESHOLD else None


def find_hud(img: np.ndarray, scale: float = 1.0) -> Hud | None:
    """Locate and read the HUD. None when no HUD is in frame.

    A cropped inventory upload has no HUD at all, and that is a legitimate
    answer -- not an error.
    """
    tpl = cv2.imread(str(TEMPLATE), cv2.IMREAD_UNCHANGED)
    if tpl is None or tpl.shape[2] != 4:
        raise FileNotFoundError(f"HUD prefix template missing from {TEMPLATE}")

    if abs(scale - 1.0) > 0.02:
        tpl = cv2.resize(tpl, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)

    th, tw = tpl.shape[:2]
    if th >= img.shape[0] or tw >= img.shape[1]:
        return None

    found = _locate(img, tpl)
    if found is None:
        return None
    score, (x, y) = found
    x0 = max(int(x - LINE_LEFT * scale), 0)
    y0 = max(int(y - LINE_UP * scale), 0)
    y1 = min(int(y + LINE_DOWN * scale), img.shape[0])
    x1 = min(int(x + LINE_RIGHT * scale), img.shape[1])
    line = img[y0:y1, x0:x1]
    if line.size == 0:
        return None

    text = _tesseract(line)
    m = HUD_RE.match(text)
    if not m:
        return None
    return Hud(name=m.group(2), level=int(m.group(1)), score=float(score))
