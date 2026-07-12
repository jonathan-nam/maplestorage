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

# The prefix is already confirmed by the template match, so this only has to
# pull the level and name back out -- it tolerates a garbled "Lv" rather than
# rejecting a HUD we have positively identified.
HUD_RE = re.compile(r"^\W*[A-Za-z]{1,2}\.?\s*(\d{1,3})\s+(\S.*?)\s*$")


@dataclass
class Hud:
    name: str
    level: int
    score: float


def _tesseract(img: np.ndarray) -> str:
    with tempfile.NamedTemporaryFile(suffix=".png") as f:
        cv2.imwrite(f.name, img)
        out = subprocess.run(
            ["tesseract", f.name, "stdout", "--psm", "7"],
            capture_output=True,
            text=True,
            timeout=15,
        )
    return out.stdout.strip()


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

    mask = cv2.cvtColor(tpl[:, :, 3], cv2.COLOR_GRAY2BGR)
    res = cv2.matchTemplate(img, tpl[:, :, :3], cv2.TM_CCOEFF_NORMED, mask=mask)
    res[~np.isfinite(res)] = -1.0
    _, score, _, loc = cv2.minMaxLoc(res)
    if score < MATCH_THRESHOLD:
        return None

    x, y = loc
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
