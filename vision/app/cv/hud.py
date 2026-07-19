"""Read the character HUD ("Lv.287 acornacorn") from a screenshot.

This is a different problem from the stack counts, and it wants the opposite
tool. The counts are an 11px bitmap font over icon art, where Tesseract scores
2/12 and matching the client's own glyphs scores 100%. The HUD is ~20px
anti-aliased proportional text on a dark plate. Ordinary rendered text, which
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
# LINE_DOWN has to clear the DESCENDERS. At 18 the crop cut the tail off a 'y', and a
# tailless 'y' is a 'u': `mechyfechy` came back as `mechufechy` and the app would have
# created a character by that name. It pairs with TARGET_LINE_HEIGHT, which normalises this
# crop's height, so the two were fitted together, see the note there.
LINE_UP, LINE_DOWN = 6, 22
LINE_RIGHT = 175

# The prefix is already confirmed by the template match, so this only has to pull
# the level and name back out, it tolerates a garbled "Lv" rather than rejecting
# a HUD we have positively identified.
#
# The name is bounded by CHARSET, not by "everything to the end of the line". That
# is the whole fix for a real bug: LINE_RIGHT is a fixed 175px crop, wide enough for
# the longest IGN, so on a SHORT name it overruns into the HUD icons sitting beside
# it and Tesseract reads them as trailing glyphs. `acornacorn` came back as
# `acornacorn?. ©` and got saved as a character by that name.
#
# A MapleStory IGN is alphanumeric. No spaces, no punctuation, no symbols. So
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
#
# It normalises the CROP's height, not the text's, so it is coupled to LINE_UP + LINE_DOWN
# and cannot be read independently of them. Growing the crop to clear descenders without
# growing this shrank the glyphs by a fifth and brought `acornacorn` -> `acornacom` back.
#
# BE CAREFUL CHANGING EITHER. The pair was chosen by sweeping both against 12 cases (five
# capture scales x PNG/JPEG, plus a real capture whose name has two 'y's), and the values
# that pass are SCATTERED, not contiguous: at LINE_DOWN 22 this passes at 64, 80, 88 and 104
# and fails at 72, 92 and 96. That is Tesseract being chaotic on an 18px proportional
# bitmap font, not a smooth optimum, so a neighbouring value is not a safe substitute and
# any change needs the whole sweep re-run. Sweeping against PNG alone is not enough either,
# several pairs that pass there fail on the JPEG the frontend actually sends.
#
# The real fix is to stop using Tesseract here and correlate the client's own glyphs, as the
# stack counts do. That needs a ~62 glyph font at HUD size, and the only multi-name capture
# we have (the character selection screen) renders the same face LARGER: 19px of ink against
# the HUD's 15px. Downscaling it would resample a bitmap font, which is the exact mistake
# cell_band() exists to undo. So it waits on captures of HUD lines covering more letters.
TARGET_LINE_HEIGHT = 88


def _ocr(img: np.ndarray) -> tuple[str, list[tuple[str, int, int]]]:
    """The line's text, and each character's x-extent in the CROP's own pixels.

    "txt makebox" is one recognition pass emitting both, so the boxes describe the
    same reading the text came from. Boxes are scaled back out of the upscale because
    the bar classifier reads the raw crop, see _fix_bars.
    """
    k = TARGET_LINE_HEIGHT / img.shape[0]
    if k > 1.0:
        # CUBIC, not LANCZOS: on text this size LANCZOS rings around the strokes.
        img = cv2.resize(img, None, fx=k, fy=k, interpolation=cv2.INTER_CUBIC)
    else:
        k = 1.0

    with tempfile.TemporaryDirectory() as d:
        src = Path(d) / "line.png"
        cv2.imwrite(str(src), img)
        subprocess.run(
            ["tesseract", str(src), str(Path(d) / "out"), "--psm", "7", "txt", "makebox"],
            capture_output=True,
            text=True,
            timeout=15,
        )
        txt = Path(d) / "out.txt"
        box = Path(d) / "out.box"
        text = txt.read_text().strip() if txt.exists() else ""
        raw_boxes = box.read_text().splitlines() if box.exists() else []

    boxes = []
    for row in raw_boxes:
        parts = row.split(" ")
        if len(parts) < 5:
            continue
        boxes.append((parts[0], int(int(parts[1]) / k), int(int(parts[3]) / k)))
    return text, boxes


# Sliding a masked template over the whole frame is expensive: 763ms on a 2359x1095
# screenshot, which was 45% of the entire parse. More than every other stage put
# together. The mask is what costs; the same match without one runs in 211ms.
#
# So search a quarter-scale copy first and only refine the winner at full resolution.
# 13x faster, and it lands on the identical pixel.
#
# The coarse pass can be wrong, and the design assumes it: the refined score is checked
# against the same threshold as before, and anything that fails falls back to the full
# frame. So the fast path is an optimisation, never a new way to be wrong. (Empirically
# 1/2 and 1/4 both land exactly; 1/3 misses badly, a 25x18 template does not survive
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
    answer, not an error.
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

    text, boxes = _ocr(line)
    m = HUD_RE.match(text)
    if not m:
        return None

    # The box file has no entry for whitespace, so the name's index in the box list is
    # its text offset less the spaces before it.
    first = len(re.sub(r"\s", "", text[: m.start(2)]))
    name = _fix_bars(line, m.group(2), boxes[first : first + len(m.group(2))])
    return Hud(name=name, level=int(m.group(1)), score=float(score))


# '1', 'l' and 'i' are one vertical stroke each at this size and Tesseract cannot separate
# them: `morebuff12` came back as `morebuffl2`, and as `morebuffi2` at a different scale.
# Retuning the crop does not help, that fixed `mechyfechy` and this broke on the very next
# name.
#
# But the client's glyphs are not actually ambiguous, only Tesseract's reading of them is:
#
#     'i'  dot over a stem, so its brightness dips where the gap is
#     'l'  a bare bar, as wide at the top as in the middle
#     '1'  a bar with a flag at the top left, so the top is clearly wider
#
# Measured on the real capture at 1.33x: the '1' is 4px wide at the top and 2px in the
# middle. So decide it from the pixels rather than from the language model, but ONLY for
# these three characters. Everything else Tesseract says is left exactly as it was.
#
# It reads the RAW crop, not the upscale Tesseract gets. The dot-stem gap is about a pixel
# and INTER_CUBIC closes it: the same 'i' that classifies correctly at native scale comes
# back 'l' at TARGET_LINE_HEIGHT.
BAR_CHARS = "1lI|i"
FLAG_RATIO = 1.5  # top wider than middle by this much is the '1' flag, measured 2.0

# The gap is one row and it does not go dark, it only dims, so asking whether the row is
# empty is a coin toss: warrior2020's 'i' gap sits at 0.53 of full ink as PNG and 0.56 as
# JPEG q92, either side of a 0.55 ink cut, which is exactly how `warrlor2020` was saved.
# Measure the dip against the stroke's own brightness instead. On the two bars in the corpus
# that separates cleanly: the 'i' dips to 0.68/0.70 of its stroke, the '1' to 0.96/0.98.
INK = 0.55
DIP_RATIO = 0.85


def _classify_bar(glyph: np.ndarray) -> str:
    """Decide one bar from a normalised (0..1) greyscale glyph."""
    prof = glyph.max(1)
    core = np.where(prof >= INK)[0]
    if not len(core):
        return "l"
    seg = prof[core.min() : core.max() + 1]

    # Ends are excluded: antialiasing dims the first and last row of any stroke.
    interior = seg[1:-1]
    plateau = float(np.median(seg[seg >= INK]))
    if len(interior) and plateau and float(interior.min()) <= DIP_RATIO * plateau:
        return "i"

    g = (glyph[core.min() : core.max() + 1] >= INK).astype(np.uint8)
    h = g.shape[0]
    if h < 3:
        return "l"  # too few rows to have a top and a middle
    top = int(g[: max(h // 3, 1)].sum(1).max())
    mid = int(g[h // 3 : 2 * h // 3].sum(1).max())
    return "1" if mid and top >= FLAG_RATIO * mid else "l"


def _fix_bars(line: np.ndarray, name: str, boxes: list[tuple[str, int, int]]) -> str:
    """Re-decide the 1/l/i characters of `name` from the pixels. Unchanged if unsure.

    Each bar is located by Tesseract's own box for that character rather than by segmenting
    the line ourselves. Segmenting cannot be made to work here: the crop is a fixed 175px and
    overruns into the HUD icons on all but the longest names, so the trailing ink is not
    always the name. `warrior2020` read correctly and was then corrupted to `warrlor2020` by
    a 1px slice of an icon that looked narrow enough to be a bar and happened to match the
    bar count. Tesseract already knows which pixels it turned into which character, so ask it.

    The boxes must still be trusted only where they agree with the text, so this bails unless
    they spell the name exactly.
    """
    hits = [i for i, c in enumerate(name) if c in BAR_CHARS]
    if not hits:
        return name
    if len(boxes) != len(name) or "".join(c for c, _, _ in boxes) != name:
        return name

    grey = cv2.cvtColor(line, cv2.COLOR_BGR2GRAY).astype(np.float32)
    lo, hi = float(grey.min()), float(grey.max())
    if hi - lo < 30:
        return name
    norm = (grey - lo) / (hi - lo)

    out = list(name)
    for idx in hits:
        _, x0, x1 = boxes[idx]
        x0, x1 = max(x0, 0), min(x1 + 1, norm.shape[1])
        if x1 - x0 < 1:
            continue
        out[idx] = _classify_bar(norm[:, x0:x1])
    return "".join(out)
