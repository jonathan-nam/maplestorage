"""Read a character's weekly boss clears from the Maple Planner's Boss Content panel.

Unlike the inventory (a square 16x8 lattice, see grid.py), the planner is a vertical list
of variable rows: [portrait | difficulty badge | name | state]. Rows sit under grey
MONTHLY/WEEKLY/DAILY headers. Two things per row are read and nothing else: WHICH BOSS
(by portrait) and CLEARED-OR-NOT (a checkmark vs an arrow glyph).

Difficulty is shown but deliberately NOT read. A player sets the planner difficulty
independent of what they actually clear (a Normal badge over a Hard clear), so it is not
trustworthy, and with income out of scope it is not needed either.

Two things make the read tractable:

  * The state glyph is a fixed bitmap. The checkmark and the arrow are drawn pixel-identical
    on every row, so, like the digit font in ocr.py, they are read by correlating the two
    known glyphs rather than by any threshold.
  * Boss rows carry a saturated difficulty badge in a fixed column; the grey section headers
    do not. Thresholding that column both FINDS the rows and severs them from the headers.

The panel is found by its cyan "Boss Content" header. Several cyan headers can share a screen
(Daily/Weekly Content look identical), so the right one is chosen by content: only Boss
Content has boss rows beneath it.
"""

from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

TEMPLATE_DIR = Path(__file__).parent / "templates"

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

# Sub-regions of a row, as fractions of panel width.
PORTRAIT_X0, PORTRAIT_X1 = 0.01, 0.11
STATE_X0, STATE_X1 = 0.85, 0.99

# Portrait match below this is UNKNOWN, never a guess. Set from the observed gap between
# true matches (>=0.95) and the worst false match among the dark, mutually-similar portraits
# (Black Mage / Zakum / Gollux, ~0.66). PROVISIONAL: tuned on same-source captures only;
# cross-account robustness needs different-character fixtures before this is trusted.
IDENTITY_MIN = 0.80


@dataclass
class BossRow:
    boss: str | None  # catalog key, or None if the portrait matched nothing
    cleared: bool
    y0: int
    y1: int
    identity_score: float
    state_score: float


@dataclass
class PlannerResult:
    rows: list[BossRow]
    reached_list_end: bool  # did the capture reach the bottom of the scroll?


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


def load_portraits(path: Path = TEMPLATE_DIR) -> dict:
    lib = {}
    for f in sorted(path.glob("boss-*.png")):
        key = f.name[len("boss-") : -len(".png")]
        lib[key] = cv2.imread(str(f))
    return lib


def _crop(panel: np.ndarray, band: tuple[int, int], x0f: float, x1f: float) -> np.ndarray:
    pw = panel.shape[1]
    a, b = band
    return panel[a:b, int(pw * x0f) : int(pw * x1f)]


def _best_match(cell: np.ndarray, templates: dict) -> tuple[str, float, float]:
    scores = {}
    for name, t in templates.items():
        if t is None or cell.size == 0:
            scores[name] = -1.0
            continue
        # Slide the template across the cell. The template is cut a touch smaller than
        # the cell it is matched against, so clamp it (never the cell) down to fit, then
        # let matchTemplate find the aligning offset. Clamping the cell instead would pin
        # both to the top-left and correlate misaligned glyphs.
        h = min(cell.shape[0], t.shape[0])
        w = min(cell.shape[1], t.shape[1])
        res = cv2.matchTemplate(cell, t[:h, :w], cv2.TM_CCOEFF_NORMED)
        scores[name] = float(res.max())
    ranked = sorted(scores.items(), key=lambda kv: -kv[1])
    top, second = ranked[0], (ranked[1] if len(ranked) > 1 else (None, -1.0))
    return top[0], top[1], top[1] - second[1]


def read_state(panel, band, glyphs) -> tuple[bool, float]:
    name, score, _ = _best_match(_crop(panel, band, STATE_X0, STATE_X1), glyphs)
    return name == "cleared", score


def read_identity(panel, band, portraits) -> tuple[str | None, float]:
    if not portraits:
        return None, 0.0
    cell = _crop(panel, band, PORTRAIT_X0, PORTRAIT_X1)
    name, score, _ = _best_match(cell, portraits)
    return (name, score) if score >= IDENTITY_MIN else (None, score)


def parse_planner(img: np.ndarray, glyphs: dict, portraits: dict) -> PlannerResult | None:
    box = find_panel(img)
    if box is None:
        return None
    x, y, w, h = box
    panel = img[y : y + h, x : x + w]
    bands = _row_bands(panel)
    rows = []
    for band in bands:
        cleared, ss = read_state(panel, band, glyphs)
        boss, ids = read_identity(panel, band, portraits)
        rows.append(BossRow(boss, cleared, y + band[0], y + band[1], ids, ss))
    # Reached the end if there is at least one row of empty panel below the last row.
    reached_end = False
    if bands:
        last = bands[-1][1]
        pitch = int(np.median([b - a for a, b in bands])) or MIN_ROW_H
        reached_end = (panel.shape[0] - last) > pitch
    return PlannerResult(rows, reached_end)
