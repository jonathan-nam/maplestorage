"""Locate the MapleStory inventory slot lattice in a screenshot.

The inventory is a 16x8 grid of square slots, and the recovered pitch doubles as the
screenshot's SCALE, which is what lets every downstream step (icon matching, count reading)
work per-cell at a known size instead of doing a free-floating multi-scale search. That search
is what made naive template matching unreliable, so getting the lattice right is the whole
foundation.

There are two ways to find it, and both are needed.

SEGMENTATION (the fast path, _grid_by_segmentation). Two properties of how the client draws a
slot make the lattice recoverable without any learned model:

  * A slot's interior is a flat light grey (~226), whether it is empty or holds an icon, the
    icon never covers the whole cell.
  * Every slot boundary is a fixed ridge (`222 214 242 238 238 242 214 222`): a bright core with
    dark flanks, ~5px of which falls outside the interior's grey band.

So thresholding to the interior band SEVERS the cells from each other, each slot falls out as
its own connected component whose bounding box *is* the slot, and a lattice is fitted to those
boxes.

CORRELATION (the fallback, _grid_by_correlation). All of the above rests on the ridge escaping
the interior band, and on a capture that has been through a lossy rescale it simply does not.
A real Parsec frame arrived with the ridge as a gentle 222 -> 236 -> 218 bump that never leaves
the band, so nothing severed, the slot bed flooded into one component, and segmentation found
SIX boxes instead of 128. No threshold fixes that: segmentation needs a hard edge and the
capture no longer has one.

Correlation does not care about hard edges, it degrades smoothly with blur instead of falling
off a cliff. And whatever the player owns, an inventory always contains the same thing in
quantity: the EMPTY SLOT. Sliding that one template over the frame gives the lattice back
directly.
"""

from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

COLS, ROWS = 16, 8

TEMPLATE_DIR = Path(__file__).parent / "templates"

# Slot interior grey. The bounds sit inside the boundary ridge's dark (214) and
# bright (238-254) extremes, which is what severs adjacent cells.
INTERIOR_LO, INTERIOR_HI = 216, 236

NATIVE_PITCH = 46.0  # slot pitch on an unscaled client screenshot
MIN_CELL, MAX_CELL = 10, 200
MIN_CELLS = 12  # fewer detected slots than this and we don't trust the fit

# A cell holding less interior grey than this is not an inventory slot we can read.
# The two ends are measured, not chosen: over the whole reference corpus at JPEG q70-q100 the
# worst genuine slot scores 0.199, and the brightest cell under four real MapleStory windows
# pasted across the lattice scores 0.112 (the Boss Matrix, which is mostly light grey itself).
# 0.15 is the midpoint. test_coverage.py re-measures both ends, so this cannot drift silently.
MIN_SLOT_GREY = 0.15


@dataclass
class Grid:
    x: float  # left edge of column 0
    y: float  # top edge of row 0
    pitch: float
    n_cells: int  # how many slots the lattice was fitted from (confidence)

    def cell(self, row: int, col: int) -> tuple[int, int, int, int]:
        p = self.pitch
        return (round(self.x + col * p), round(self.y + row * p), round(p), round(p))

    @property
    def scale(self) -> float:
        return self.pitch / NATIVE_PITCH


@dataclass
class Coverage:
    """Which of the lattice's 128 slots the frame actually shows.

    This is what licenses the backend to treat an item's ABSENCE as a zero. Without it,
    absence is ambiguous between "the player has none", "it scrolled out of frame" and
    "a window was covering it", and only the first of those is a zero. Guessing wrong
    deletes a real stack.
    """

    off_frame: int  # cells the lattice puts outside the image
    occluded: int  # cells in frame that do not look like a slot

    @property
    def complete(self) -> bool:
        return self.off_frame == 0 and self.occluded == 0


def coverage(img: np.ndarray, g: Grid) -> Coverage:
    """Account for every cell of the lattice, so absence can mean zero."""
    h_img, w_img = img.shape[:2]
    grey = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    band = cv2.inRange(grey, INTERIOR_LO, INTERIOR_HI)

    off_frame = occluded = 0
    for r in range(ROWS):
        for c in range(COLS):
            x, y, w, h = g.cell(r, c)
            if x < 0 or y < 0 or x + w > w_img or y + h > h_img:
                off_frame += 1
            elif band[y : y + h, x : x + w].mean() / 255.0 < MIN_SLOT_GREY:
                occluded += 1
    return Coverage(off_frame=off_frame, occluded=occluded)


def _cell_boxes(img: np.ndarray) -> list[tuple[int, int, int, int]]:
    """Bounding boxes of things that look like inventory slots."""
    grey = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    mask = cv2.inRange(grey, INTERIOR_LO, INTERIOR_HI)

    n, _, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=4)
    boxes = []
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        if not (MIN_CELL <= w <= MAX_CELL and MIN_CELL <= h <= MAX_CELL):
            continue
        # Slots are square.
        if abs(w - h) > max(2, 0.18 * max(w, h)):
            continue
        # An empty slot fills its box; a slot with an icon is a grey annulus
        # around the icon. Both are ruled out by a very sparse box.
        if area < 0.15 * w * h:
            continue
        boxes.append((x, y, w, h))
    return boxes


def _dominant_size(boxes) -> float:
    """Modal slot size: the lattice's cells all share one size, strays don't."""
    sizes = np.array([(w + h) / 2 for _, _, w, h in boxes], dtype=float)
    # Cluster by rounding to integers and taking the densest 15% band.
    best, best_n = None, 0
    for s in np.unique(np.round(sizes)):
        n = int(np.sum(np.abs(sizes - s) <= 0.15 * s))
        if n > best_n:
            best, best_n = s, n
    return float(best)


def _pitch_from_spacing(centers: np.ndarray, size: float) -> float:
    """Lattice period, as the modal gap between adjacent rows (or columns)."""
    uniq = np.sort(np.unique(np.round(centers)))
    groups, cur = [], [uniq[0]]
    for v in uniq[1:]:
        if v - cur[-1] <= 0.5 * size:
            cur.append(v)
        else:
            groups.append(np.mean(cur))
            cur = [v]
    groups.append(np.mean(cur))

    diffs = np.diff(np.array(groups))
    diffs = diffs[diffs > 0.5 * size]
    return float(np.median(diffs)) if len(diffs) else size


def _largest_lattice_block(cx, cy, pitch):
    """Pick out the inventory grid from any other slot-like boxes on screen.

    Other UI (quick-slot bars, the Maple Planner's checkboxes) also yields square
    grey boxes, and they will happily corrupt a naive fit. The real inventory is
    distinguished by two things the strays don't share: its cells sit on a single
    lattice phase, and they form one contiguous block. So we keep the modal phase
    and then take the largest 4-connected cluster in lattice space.
    """

    # 1. Modal phase, per axis. Cells of one grid agree on (centre mod pitch).
    def modal_phase(c):
        ph = np.mod(c, pitch)
        # Circular mode via the strongest unit vector, so wraparound is harmless.
        ang = ph / pitch * 2 * np.pi
        mean = np.arctan2(np.sin(ang).mean(), np.cos(ang).mean())
        return float(np.mod(mean, 2 * np.pi) / (2 * np.pi) * pitch)

    phx, phy = modal_phase(cx), modal_phase(cy)

    def on_phase(c, ph):
        d = np.mod(c - ph, pitch)
        return np.minimum(d, pitch - d) <= 0.22 * pitch

    keep = on_phase(cx, phx) & on_phase(cy, phy)
    cx, cy = cx[keep], cy[keep]
    if len(cx) < MIN_CELLS:
        raise ValueError(f"only {len(cx)} cells share a lattice phase")

    # 2. Anchor the 16x8 window that captures the most cells.
    #
    # Taking the largest 4-connected cluster instead looks equivalent and is not:
    # JPEG noise erodes slots until the inventory's own block *fragments*, and
    # then some unrelated cluster wins and the origin lands hundreds of pixels
    # away (this failed at JPEG q=80 while working at q=75 and q=85). Counting
    # cells inside a fixed-size window does not care whether they are contiguous.
    ci = np.round((cx - cx.min()) / pitch).astype(int)
    ri = np.round((cy - cy.min()) / pitch).astype(int)

    best, best_n, anchor = None, -1, (0, 0)
    for r0 in range(int(ri.min()), int(ri.max()) + 1):
        for c0 in range(int(ci.min()), int(ci.max()) + 1):
            inside = (ri >= r0) & (ri < r0 + ROWS) & (ci >= c0) & (ci < c0 + COLS)
            n = int(inside.sum())
            if n > best_n:
                best, best_n, anchor = inside, n, (r0, c0)
    if best_n < MIN_CELLS:
        raise ValueError(f"best 16x8 window holds only {best_n} slots")

    r0, c0 = anchor
    bx, by = cx[best], cy[best]
    br, bc = ri[best], ci[best]

    # 3. Origin = the *window's* top-left corner, not lattice index 0.
    #
    # Indexing is relative to the left-most/top-most cell we happened to detect,
    # which is not necessarily an inventory slot: a couple of stray boxes from
    # other UI are enough to drag index 0 outside the panel, and anchoring there
    # put the origin hundreds of pixels away in the Maple Planner. Subtracting the
    # window's own corner ties the origin to the block we actually selected.
    ox = float(np.median(bx - (bc - c0) * pitch)) - pitch / 2
    oy = float(np.median(by - (br - r0) * pitch)) - pitch / 2
    return ox, oy, best_n


# --- The blurred-capture path ---------------------------------------------------------
#
# Everything above rests on one assumption: that thresholding to the interior grey SEVERS
# adjacent cells, because the boundary ridge (222 214 242 238 238 242 214 222) swings well
# outside the 216-236 band. On a capture that has been through a lossy rescale, a
# remote-play stream (Parsec, Moonlight) whose client window does not match the host, that
# is simply not true any more. Measured across a real Parsec boundary, the ridge arrives as
# a gentle 222 -> 236 -> 218 bump that never leaves the interior band, so nothing severs, the
# whole slot bed floods into one component, and the detector finds SIX boxes instead of 128.
#
# The fix is not a better threshold. Segmentation needs a hard edge and the capture no longer
# has one, at any threshold. (Cutting the mask with the ridge gradient does resurrect ~37
# blobs, but they are eroded asymmetrically. Sizes 11 to 129 px, left edges scattered over
# the whole period, and only 9 of them share a lattice phase. They are fragments, not slots.)
#
# Correlation, on the other hand, does not care about hard edges: it degrades smoothly with
# blur instead of falling off a cliff. And an inventory always contains the same thing in
# quantity, whatever the player owns and at whatever scale, the EMPTY SLOT. Sliding that one
# template over the frame at the measured pitch gives back the lattice directly: on the Parsec
# frame, 139 peaks at up to 0.938, whose modal phase lands within 1-2px of the phase recovered
# completely independently by matching the catalog's item icons. Two unrelated signals agreeing
# is what makes this trustworthy rather than merely plausible.
#
# This runs only when segmentation has already failed, so a native capture is untouched by it.
SLOT_PEAK_THRESHOLD = 0.50
PITCH_SEARCH = (40.0, 90.0)


def _pitch_by_periodicity(img: np.ndarray) -> float:
    """The lattice period, from the autocorrelation of the slot ridges.

    Blur lowers the ridges' contrast but cannot change their SPACING, so periodicity
    survives a rescale that destroys segmentation entirely.
    """
    grey = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)
    best = None
    for axis in (0, 1):
        d = cv2.Sobel(grey, cv2.CV_32F, 1 - axis, axis, ksize=3)
        prof = np.abs(d).mean(axis=axis)
        prof = prof - prof.mean()
        ac = np.correlate(prof, prof, "full")[len(prof) - 1 :]
        lo, hi = int(PITCH_SEARCH[0]), int(min(PITCH_SEARCH[1], len(ac) - 1))
        if hi <= lo:
            continue
        p = lo + int(np.argmax(ac[lo:hi]))
        best = p if best is None else (best + p) / 2
    if best is None:
        raise ValueError("no periodic structure")
    return float(best)


def _slot_peaks(img: np.ndarray, pitch: float) -> tuple[np.ndarray, np.ndarray]:
    """Top-left corners of everything that correlates with an empty slot at this pitch."""
    tpl = cv2.imread(str(TEMPLATE_DIR / "slot_empty.png"), cv2.IMREAD_COLOR)
    if tpl is None:
        raise ValueError("slot_empty.png missing")
    p = int(round(pitch))
    tpl = cv2.resize(tpl, (p, p), interpolation=cv2.INTER_CUBIC)
    if img.shape[0] <= p or img.shape[1] <= p:
        raise ValueError("frame smaller than one slot")

    res = cv2.matchTemplate(img, tpl, cv2.TM_CCOEFF_NORMED)
    res[~np.isfinite(res)] = -1.0

    # One peak per slot: suppress everything that is not the local max over a full period,
    # or a single slot answers as a smear of adjacent offsets and drags the phase around.
    k = max(int(pitch * 0.6) | 1, 3)
    peak = res >= cv2.dilate(res, np.ones((k, k), np.uint8))
    ys, xs = np.where(peak & (res >= SLOT_PEAK_THRESHOLD))
    return xs, ys


def _grid_by_correlation(img: np.ndarray) -> Grid:
    pitch = _pitch_by_periodicity(img)
    xs, ys = _slot_peaks(img, pitch)
    if len(xs) < MIN_CELLS:
        raise ValueError(f"only {len(xs)} slots correlate with an empty slot")

    # The peaks are cell CORNERS; the lattice fit below is written in terms of centres.
    cx = xs.astype(float) + pitch / 2
    cy = ys.astype(float) + pitch / 2
    ox, oy, n = _largest_lattice_block(cx, cy, pitch)
    return Grid(x=ox, y=oy, pitch=pitch, n_cells=n)


def find_grid(img: np.ndarray) -> Grid:
    """Detect the inventory lattice. Raises ValueError if none is found."""
    try:
        return _grid_by_segmentation(img)
    except ValueError:
        # Not "no inventory". Possibly an inventory whose slot boundaries have been
        # smeared past severing. Correlation can still find it.
        return _grid_by_correlation(img)


def _grid_by_segmentation(img: np.ndarray) -> Grid:
    boxes = _cell_boxes(img)
    if len(boxes) < MIN_CELLS:
        raise ValueError(f"only {len(boxes)} slot-like boxes found")

    size = _dominant_size(boxes)
    cells = [b for b in boxes if abs((b[2] + b[3]) / 2 - size) <= 0.15 * size]
    if len(cells) < MIN_CELLS:
        raise ValueError(f"only {len(cells)} slots at the dominant size {size:.1f}")

    cx = np.array([x + w / 2 for x, _, w, _ in cells])
    cy = np.array([y + h / 2 for _, y, _, h in cells])
    pitch = (_pitch_from_spacing(cx, size) + _pitch_from_spacing(cy, size)) / 2

    ox, oy, n = _largest_lattice_block(cx, cy, pitch)
    return Grid(x=ox, y=oy, pitch=pitch, n_cells=n)


def draw(img: np.ndarray, g: Grid) -> np.ndarray:
    vis = img.copy()
    for r in range(ROWS):
        for c in range(COLS):
            x, y, w, h = g.cell(r, c)
            cv2.rectangle(vis, (x, y), (x + w, y + h), (0, 220, 0), 1)
    return vis


class OccludedInventory(ValueError):
    """Part of the fitted lattice is not inventory at all.

    Either another window is sitting over the grid, or the fit landed on the slots that were
    still visible and ran off the window's edge. Both produce the same silent damage: the slots
    underneath are never read, and the counts taken from what is left are an undercount that
    looks exactly like a real one. A player with a Maple Planner open over their inventory read
    16 items instead of 23, and one item's second stack (340 + 1) lost its 1.
    """


# How much of a cell must sit in the interior grey band for it to count as a real slot.
#
# Not every filled slot passes: a dense icon covers most of its cell. That is why the test below
# asks whether a whole ROW OR COLUMN is devoid of slots, rather than whether every cell is one.
# Eight chances per column is what makes it robust to individual crowded slots.
#
# 0.20 is mid-band, not tuned to the failing capture. Swept across the reference corpus, every
# capture that parses correctly has zero dead lines for any threshold in 0.05-0.30, and only
# starts producing one at 0.40. The occluded capture has 6 dead lines at 0.20 and 9 at 0.30.
SLOT_INTERIOR_MIN = 0.20


def assert_unoccluded(img: np.ndarray, g: Grid) -> None:
    """Refuse a lattice that is not sitting on a whole inventory.

    Deliberately NOT a count of how many cells look like slots. A blurred rescaled capture has
    mushy slot boundaries and correlates far fewer cells than a clean one (22 of 128 against 127
    on the real 1.326x fixture), so a completeness threshold would refuse the blurriest capture we
    own while passing the occluded one. What separates them is WHERE the misses fall: blur
    scatters them, an overlapping window wipes out whole columns at once.
    """
    grey = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    mask = cv2.inRange(grey, INTERIOR_LO, INTERIOR_HI)

    slotlike = np.zeros((ROWS, COLS), bool)
    for r in range(ROWS):
        for c in range(COLS):
            x, y, w, h = g.cell(r, c)
            cell = mask[max(y, 0) : y + h, max(x, 0) : x + w]
            slotlike[r, c] = cell.size > 0 and cell.mean() / 255.0 > SLOT_INTERIOR_MIN

    dead_cols = int((~slotlike.any(axis=0)).sum())
    dead_rows = int((~slotlike.any(axis=1)).sum())
    if dead_cols or dead_rows:
        raise OccludedInventory(
            f"{dead_cols} of {COLS} columns and {dead_rows} of {ROWS} rows hold no inventory slot"
        )
