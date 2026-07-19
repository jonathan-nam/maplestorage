"""Read a character's weekly boss clears from the Maple Planner's Boss Content panel.

Unlike the inventory (a square 16x8 lattice, see grid.py), the planner is a vertical list
of variable rows: [portrait | difficulty badge | name | state]. Rows sit under grey
MONTHLY/WEEKLY/DAILY headers. Two things per row are read and nothing else: WHICH BOSS
(by its name) and CLEARED-OR-NOT (a checkmark vs an arrow glyph).

Difficulty is shown but deliberately NOT read. A player sets the planner difficulty
independent of what they actually clear (a Normal badge over a Hard clear), so it is not
trustworthy, and with income out of scope it is not needed either.

Two mechanisms carry the read:

  * The state glyph both FINDS the rows and reads their state. The checkmark and arrow are
    pixel-identical bitmaps on every row (like the digit font in ocr.py), so sliding the two
    known glyphs down the state column locates each boss row and says cleared-or-not at once.
    It is colour-agnostic, which matters: enumerating rows by the difficulty badge's colour
    silently drops the dark CHAOS/EXTREME rows (Gloom, Guardian Angel Slime and the like). The
    glyph also skips the section headers and the game world below the panel, which carry none.
    Badge saturation is still used, but only coarsely, to let find_panel pick the right column.
  * The boss NAME is ordinary rendered text, which Tesseract reads well (unlike the tiny
    count font in ocr.py). The read is matched to the known boss list, so it needs no per-boss
    image asset: a new boss is a new name in the catalog, nothing to cut. This is why identity
    is the name and not the portrait. Truncated names ("Guardian Angel Sli..") still resolve
    because the match is by best overlap against the list.

The panel is found by its cyan "Boss Content" header. Several cyan headers can share a screen
(Daily/Weekly Content look identical), so the right one is chosen by content: only Boss
Content has boss rows beneath it.
"""

import difflib
import json
import re
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

TEMPLATE_DIR = Path(__file__).parent / "templates"
BOSS_CATALOG = Path(__file__).parent / "boss_catalog.json"

# "Boss Content" header: a wide, short, saturated cyan bar. Aspect (not absolute size)
# keeps this scale-tolerant; the exact panel is then confirmed by finding rows below it.
_CYAN_LO = np.array([88, 120, 150])
_CYAN_HI = np.array([105, 255, 255])
HEADER_MIN_ASPECT = 4.0  # width / height; rules out cyan glyphs and icons
HEADER_MIN_WIDTH_FRAC = 0.06  # of image width

# A boss row's badge column, as fractions of panel width. The badge is always coloured;
# the section headers are flat grey, so mean saturation here separates rows from headers.
BADGE_X0, BADGE_X1 = 0.12, 0.32
BADGE_SAT_MIN = 50.0  # mean saturation over the badge column marking a boss row
MIN_ROW_H = 12  # px; shorter saturated runs are noise, not a row

# Every boss row, at any difficulty, carries a state glyph (checkmark or arrow); the grey section
# headers and the game world below the panel do not. So rows are enumerated by sliding the two
# glyphs down the state column, which is colour-agnostic. This is why the badge-saturation pass
# is NOT used to enumerate rows: a dark CHAOS/EXTREME badge scores under BADGE_SAT_MIN and its row
# would be silently dropped. Badge saturation only has to be good enough for find_panel to pick
# the Boss Content column out of the identical-looking Daily/Weekly ones.
STATE_ROW_MIN = 0.62  # a slot is a boss row if a state glyph matches at least this
ROW_MIN_SEP_FACTOR = 1.0  # min row spacing as a multiple of glyph height (dedupe match peaks)
EMPTY_SAT_MAX = 30.0  # below the last row, mean saturation under this reads as blank panel (end)

# Sub-regions of a row, as fractions of panel width.
NAME_X0, NAME_X1 = 0.34, 0.84
STATE_X0, STATE_X1 = 0.85, 0.99
NAME_PAD = 5  # px; the badge band is shorter than the row, pad it to catch the full name
OCR_TARGET_H = 64  # upscale the name line to this before Tesseract (see hud.py)

# Name match below this is UNKNOWN, never a guess. True reads score >=0.83 (incl. an OCR
# slip "Darien" -> Damien), empty reads score 0; 0.62 sits in the gap with margin.
NAME_MATCH_MIN = 0.62


def load_boss_catalog(path: Path = BOSS_CATALOG) -> list[dict]:
    """The boss catalog, generated from catalog/bosses.yaml by build.py (one source of truth)."""
    return json.loads(path.read_text())


def load_boss_names(path: Path = BOSS_CATALOG) -> list[str]:
    return [b["name"] for b in load_boss_catalog(path)]


# Loaded once at import, like the templates. build.py regenerates the catalog from the manifest.
BOSS_NAMES = load_boss_names()

# The reader identifies a boss by NAME (that is what is on screen), but `key` is the stable
# identifier the backend keys clears on, so the name -> key resolution belongs here, next to the
# catalog both sides come from, rather than in a second hand-kept mapping.
BOSS_KEY_BY_NAME = {b["name"]: b["key"] for b in load_boss_catalog()}


@dataclass
class BossRow:
    boss: str | None  # canonical boss name, or None if the name matched nothing
    cleared: bool
    y0: int
    y1: int
    name_score: float
    state_score: float


@dataclass
class PlannerResult:
    rows: list[BossRow]
    reached_list_end: bool  # did the capture reach the bottom of the scroll?
    panel: tuple[int, int, int, int]  # Boss Content panel box (x, y, w, h) in image coords


def _cyan_bars(img: np.ndarray) -> list[tuple[int, int, int, int]]:
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    mask = cv2.inRange(hsv, _CYAN_LO, _CYAN_HI)
    n, _, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    min_w = img.shape[1] * HEADER_MIN_WIDTH_FRAC
    bars = []
    for i in range(1, n):
        x, y, w, h = (
            stats[i, cv2.CC_STAT_LEFT],
            stats[i, cv2.CC_STAT_TOP],
            stats[i, cv2.CC_STAT_WIDTH],
            stats[i, cv2.CC_STAT_HEIGHT],
        )
        if w >= min_w and w >= HEADER_MIN_ASPECT * h:
            bars.append((int(x), int(y), int(w), int(h)))
    return sorted(bars, key=lambda b: b[1])


def _row_bands(panel: np.ndarray) -> list[tuple[int, int]]:
    """Saturated runs in the badge column, one per boss row, headers excluded."""
    hsv = cv2.cvtColor(panel, cv2.COLOR_BGR2HSV)
    sat = hsv[:, :, 1].astype(np.float32)
    ph, pw = sat.shape
    prof = sat[:, int(pw * BADGE_X0) : int(pw * BADGE_X1)].mean(axis=1)
    on = prof > BADGE_SAT_MIN
    bands, start = [], None
    for y in range(ph):
        if on[y] and start is None:
            start = y
        elif not on[y] and start is not None:
            if y - start >= MIN_ROW_H:
                bands.append((start, y))
            start = None
    if start is not None and ph - start >= MIN_ROW_H:
        bands.append((start, ph))
    return bands


def find_panel(img: np.ndarray) -> tuple[int, int, int, int] | None:
    """Locate the Boss Content column: the cyan header with the most boss rows under it."""
    best, best_n = None, 0
    for x, y, w, h in _cyan_bars(img):
        col = img[y + h :, x : x + w]
        n = len(_row_bands(col)) if col.size else 0
        if n > best_n:
            best, best_n = (x, y + h, w, img.shape[0] - (y + h)), n
    return best if best_n >= 3 else None


def load_state_glyphs(path: Path = TEMPLATE_DIR) -> dict:
    g = {}
    for state, f in (("cleared", "planner-check.png"), (False, "planner-arrow.png")):
        im = cv2.imread(str(path / f))
        if im is None:
            raise ValueError(f"missing state glyph {f}")
        g["cleared" if state == "cleared" else "pending"] = im
    return g


def _crop(panel: np.ndarray, band: tuple[int, int], x0f: float, x1f: float) -> np.ndarray:
    pw = panel.shape[1]
    a, b = band
    return panel[a:b, int(pw * x0f) : int(pw * x1f)]


def _detect_rows(panel: np.ndarray, glyphs: dict) -> list[tuple[int, int, bool, float]]:
    """Boss rows, found by the state glyph. Returns (y0, y1, cleared, score), top to bottom.

    Slides each glyph down the state column and keeps every strong peak, deduped to one per row.
    Colour-agnostic, so it catches the dark CHAOS/EXTREME rows that badge saturation misses, and
    ignores the section headers and the game world below the panel (neither has a state glyph).
    """
    ph, pw = panel.shape[:2]
    col = panel[:, int(pw * STATE_X0) : int(pw * STATE_X1)]
    dets: list[tuple[int, bool, float, int]] = []  # (y, cleared, score, glyph_h)
    for name, t in glyphs.items():
        th = min(t.shape[0], col.shape[0])
        tw = min(t.shape[1], col.shape[1])
        if th < 1 or tw < 1:
            continue
        # The winning glyph scores ~1.0 at its row and the losing one ~0.45, so at STATE_ROW_MIN
        # only the true state clears the bar; each row yields one detection.
        per_y = cv2.matchTemplate(col, t[:th, :tw], cv2.TM_CCOEFF_NORMED).max(axis=1)
        for yy in np.where(per_y >= STATE_ROW_MIN)[0]:
            dets.append((int(yy), name == "cleared", float(per_y[yy]), th))
    if not dets:
        return []
    sep = int(dets[0][3] * ROW_MIN_SEP_FACTOR)
    dets.sort(key=lambda d: -d[2])  # strongest first, so NMS keeps the best per row
    kept: list[tuple[int, bool, float, int]] = []
    for d in dets:
        if all(abs(d[0] - k[0]) >= sep for k in kept):
            kept.append(d)
    kept.sort()
    return [(y, y + h, cleared, sc) for (y, cleared, sc, h) in kept]


def _ocr_line(crop: np.ndarray) -> str:
    """OCR one name line. Binarise to dark text on white, upscale, then Tesseract psm 7."""
    grey = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    _, th = cv2.threshold(grey, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    if th.mean() < 127:  # the name text is light on a dark row; keep background white
        th = 255 - th
    k = OCR_TARGET_H / th.shape[0]
    if k > 1.0:
        th = cv2.resize(th, None, fx=k, fy=k, interpolation=cv2.INTER_CUBIC)
    with tempfile.NamedTemporaryFile(suffix=".png") as f:
        cv2.imwrite(f.name, th)
        out = subprocess.run(
            ["tesseract", f.name, "stdout", "--psm", "7"],
            capture_output=True,
            text=True,
            timeout=15,
        )
    return out.stdout.strip()


def _norm(s: str) -> str:
    return re.sub(r"[^a-z]", "", s.lower())


def match_boss(text: str, names: list[str]) -> tuple[str | None, float]:
    """Best canonical boss for an OCR'd name. Prefix (for truncation) beats plain overlap."""
    o = _norm(text)
    if not o:
        return None, 0.0
    best, best_score = None, 0.0
    for name in names:
        c = _norm(name)
        r = difflib.SequenceMatcher(None, o, c).ratio()
        if c.startswith(o) or o.startswith(c):
            r = max(r, 0.85 + 0.1 * min(len(o), len(c)) / max(len(c), 1))
        if r > best_score:
            best, best_score = name, r
    return (best, best_score) if best_score >= NAME_MATCH_MIN else (None, best_score)


def read_name(panel, band, names) -> tuple[str | None, float]:
    a, b = band
    ph = panel.shape[0]
    padded = (max(a - NAME_PAD, 0), min(b + NAME_PAD, ph))
    text = _ocr_line(_crop(panel, padded, NAME_X0, NAME_X1))
    return match_boss(text, names)


def parse_planner(
    img: np.ndarray, glyphs: dict, names: list[str] = BOSS_NAMES
) -> PlannerResult | None:
    box = find_panel(img)
    if box is None:
        return None
    x, y, w, h = box
    panel = img[y : y + h, x : x + w]
    dets = _detect_rows(panel, glyphs)

    rows = []
    for a, b, cleared, ss in dets:
        boss, ns = read_name(panel, (a, b), names)
        rows.append(BossRow(boss, cleared, y + a, y + b, ns, ss))

    # End reached only if the panel is blank just below the last row. Content there (another row,
    # or the game world when the panel runs off a full screenshot) means the list was cut off.
    # Best-effort: the reliable completeness guard is backend routine-reconciliation across weeks.
    reached_end = False
    if dets:
        last_b = dets[-1][1]
        starts = [a for a, *_ in dets]
        pitch = int(np.median(np.diff(starts))) if len(starts) > 1 else (dets[0][1] - dets[0][0])
        # Look two rows past the last one: a genuine list-end leaves blank panel there, whereas a
        # capture cut off mid-list has the next row or (on a full screenshot) the game world close
        # below. Require the whole window blank, so game world nearby reads as "more to scroll".
        below = panel[last_b : min(last_b + 2 * pitch, panel.shape[0])]
        blank = (
            below.size
            and float(cv2.cvtColor(below, cv2.COLOR_BGR2HSV)[:, :, 1].mean()) < EMPTY_SAT_MAX
        )
        reached_end = bool(blank)
        box = (x, y, w, min(last_b + pitch, h))

    return PlannerResult(rows, reached_end, box)
