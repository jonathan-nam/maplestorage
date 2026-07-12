"""Identify the item in every slot, in time that does not grow with the catalog.

`match.find_tokens` slides one `matchTemplate` per catalog item across the whole
grid. That is fine for 6 tokens (~0.4s) and unusable for an item catalog: it is
O(N), so ~4s at 50 items and ~38s at 500.

This does it in two stages instead:

  1. Shortlist (cheap, O(N) but trivially so). Every slot becomes one small
     descriptor; one matmul scores all 128 slots against all N items. At 500
     items that is ~12ms.
  2. Verify (exact, O(1) in N). Only the top-k candidates per slot are checked,
     with the same masked correlation the 6-token matcher already uses -- which
     scores 1.000 on a true match and ~0.3 on a false one.

The split matters because each stage is bad at the other's job. The descriptor
*ranks* well (recall@1 was 5/5 on both held-out screenshots) but its absolute
score does not separate "this is a catalog item" from "this is some other item"
-- an unrelated icon's nearest neighbour still scores ~0.7, so thresholding on
it is hopeless. Verification is what discriminates; the descriptor only decides
what is worth verifying.

Three things had to be true for the descriptor to rank at all, and each was a
failed attempt first:

  * Background must be subtracted. The slot's grey backing dominates the vector
    otherwise, and every slot correlates with every other (margin -0.41).
  * It must be shift-tolerant. `matchTemplate` slides; a fixed descriptor does
    not, so a 1px grid-origin difference between screenshots destroys a
    pixel-exact vector. Downsampling to 16x16 blurs that jitter away.
  * Exact pixel hashing does not work at all. The slot backing has a per-row
    gradient, so the same icon hashes differently in different rows -- 302
    distinct hashes across 308 slots, zero collisions.
"""

from dataclasses import dataclass

import cv2
import numpy as np

from .grid import COLS, ROWS, Grid

DESC = 16  # descriptor is DESC x DESC; large enough to rank, small enough to blur 1px jitter
TOP_K = 3  # candidates per slot handed to the verify stage
VERIFY_THRESHOLD = 0.55  # same bar find_tokens uses; a true match scores ~1.0

# A masked matchTemplate costs ~2.4ms; the same match without a mask costs ~0.5ms, and
# verify ran the masked one ~270 times per parse (90 busy slots x TOP_K). That was 650ms
# -- two thirds of the whole pipeline -- spent almost entirely on candidates that were
# never going to match.
#
# So run the cheap unmasked correlation first and only pay for the masked one when it
# could plausibly matter. The masked verify still makes every decision; this only decides
# what is worth asking it about, so accuracy is unchanged by construction.
#
# The threshold is deliberately slack, because the two errors are not symmetric:
#
#   a false POSITIVE here is free    -- the masked verify runs and correctly rejects it
#   a false NEGATIVE here loses a token, silently, and an undercount is the one failure
#                                       this whole project exists to prevent
#
# Measured across the corpus at native and 2x: real matches never scored below 0.762
# unmasked, non-matches never above 0.583. 0.65 sits below every real match with room to
# spare, and lets a few non-matches through to be rejected properly -- which is exactly
# the direction to err in.
PREFILTER_THRESHOLD = 0.65

# Regions that are not the item: the stack count (differs per screenshot) and
# the untradeable bar (per-item state, not identity).
_KEEP = np.ones((46, 46), np.float32)
_KEEP[26:41, 0:44] = 0
_KEEP[40:, :] = 0


@dataclass
class SlotItem:
    name: str
    row: int
    col: int
    score: float


def _busy(cell: np.ndarray) -> float:
    """How much of a slot's interior is not backing. Near zero for an empty slot."""
    g = cv2.cvtColor(cell[6:40, 6:40], cv2.COLOR_BGR2GRAY)
    return float(((g < 214) | (g > 238)).mean())


def background(cells: dict) -> np.ndarray:
    """The slot backing, taken as the median of the empty slots in this frame."""
    empties = [c.astype(np.float32) for c in cells.values() if _busy(c) < 0.02]
    if not empties:
        # A completely full inventory: fall back to the flat backing colour.
        return np.full((46, 46, 3), 226.0, np.float32)
    return np.median(np.stack(empties), axis=0)


def descriptor(cell: np.ndarray, bg: np.ndarray) -> np.ndarray:
    d = (cell.astype(np.float32) - bg).mean(axis=2) * _KEEP
    d = cv2.resize(d, (DESC, DESC), interpolation=cv2.INTER_AREA).ravel()
    d -= d.mean()
    n = np.linalg.norm(d)
    return d / n if n > 1e-6 else d


def slot_cells(img: np.ndarray, g: Grid) -> dict:
    out = {}
    for r in range(ROWS):
        for c in range(COLS):
            x, y, w, h = g.cell(r, c)
            cell = img[max(y, 0) : y + h, max(x, 0) : x + w]
            if cell.shape[:2] == (46, 46):
                out[(r, c)] = cell
    return out


def build_catalog(templates: dict) -> tuple[list[str], np.ndarray]:
    """Descriptors for the catalog. Templates are full-slot RGBA crops."""
    names = sorted(templates)
    bg = np.full((46, 46, 3), 226.0, np.float32)
    mat = np.stack([descriptor(templates[n][:, :, :3], bg) for n in names])
    return names, mat


def _slot_window(img, g, r, c):
    """The slot, padded -- icon art bleeds a couple of pixels outside its cell, and a
    template confined strictly within the cell can never line up."""
    x, y, w, h = g.cell(r, c)
    pad = 6
    return img[max(y - pad, 0) : y + h + pad, max(x - pad, 0) : x + w + pad]


def _verify(img, g, r, c, tpl) -> float:
    """Exact masked correlation of one template against one slot.

    Prefiltered: the unmasked correlation is ~5x cheaper and bounds the masked one
    closely enough to say "definitely not this" without paying for the mask. Anything
    that clears PREFILTER_THRESHOLD still gets the real, masked answer -- the prefilter
    only skips work, it never decides.
    """
    win = _slot_window(img, g, r, c)
    th, tw = tpl.shape[:2]
    if win.shape[0] <= th or win.shape[1] <= tw:
        return -1.0

    rough = cv2.matchTemplate(win, tpl[:, :, :3], cv2.TM_CCOEFF_NORMED)
    if float(rough.max()) < PREFILTER_THRESHOLD:
        return -1.0

    mask = cv2.cvtColor(tpl[:, :, 3], cv2.COLOR_GRAY2BGR)
    res = cv2.matchTemplate(win, tpl[:, :, :3], cv2.TM_CCOEFF_NORMED, mask=mask)
    res[~np.isfinite(res)] = -1.0
    return float(res.max())


def classify(img: np.ndarray, g: Grid, templates: dict) -> list[SlotItem]:
    names, cat = build_catalog(templates)
    cells = slot_cells(img, g)
    bg = background(cells)

    keys = [k for k, cell in cells.items() if _busy(cell) >= 0.02]  # skip empty slots
    if not keys:
        return []

    D = np.stack([descriptor(cells[k], bg) for k in keys])
    scores = D @ cat.T  # (slots x catalog) -- one matmul
    order = np.argsort(scores, axis=1)[:, ::-1][:, :TOP_K]

    found = []
    for i, (r, c) in enumerate(keys):
        best = (-1.0, None)
        for j in order[i]:
            s = _verify(img, g, r, c, templates[names[j]])
            if s > best[0]:
                best = (s, names[j])
        if best[0] >= VERIFY_THRESHOLD:
            found.append(SlotItem(name=best[1], row=r, col=c, score=best[0]))
    return found
