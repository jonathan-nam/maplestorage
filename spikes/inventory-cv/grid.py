"""Locate the MapleStory inventory slot lattice in a screenshot.

The inventory is a 16x8 grid of square slots. Two properties of how the client
draws it make the lattice recoverable without any learned model:

  * A slot's interior is a flat light grey (~226), whether it is empty or holds
    an icon -- the icon never covers the whole cell.
  * Every slot boundary is a fixed ridge (`222 214 242 238 238 242 214 222`):
    a bright core with dark flanks, ~5px of which falls outside the interior's
    grey band.

So thresholding to the interior band severs the cells from each other, and each
slot falls out as its own connected component whose bounding box *is* the slot.
We then fit a lattice to those boxes. The recovered pitch doubles as the
screenshot's scale factor, which lets every downstream step (icon matching,
count reading) work per-cell at a known scale instead of doing a free-floating
multi-scale search -- which is what made naive template matching unreliable.
"""

from dataclasses import dataclass

import cv2
import numpy as np

COLS, ROWS = 16, 8

# Slot interior grey. The bounds sit inside the boundary ridge's dark (214) and
# bright (238-254) extremes, which is what severs adjacent cells.
INTERIOR_LO, INTERIOR_HI = 216, 236

NATIVE_PITCH = 46.0  # slot pitch on an unscaled client screenshot
MIN_CELL, MAX_CELL = 10, 200
MIN_CELLS = 12  # fewer detected slots than this and we don't trust the fit


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
            inside = (
                (ri >= r0) & (ri < r0 + ROWS) & (ci >= c0) & (ci < c0 + COLS)
            )
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


def find_grid(img: np.ndarray) -> Grid:
    """Detect the inventory lattice. Raises ValueError if none is found."""
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
