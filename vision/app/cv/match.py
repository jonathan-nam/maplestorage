"""Classify each inventory slot against the fixed 6-token catalog.

Because `grid.find_grid` recovers the slot pitch, we know the screenshot's scale
before matching, and we know exactly where each slot is. That reduces icon
detection from an open-ended multi-scale search over the whole image (which is
what produced unusable separation between present and absent tokens) to a
bounded per-cell classification: resize the template once, slide it only inside
the one cell it could occupy, and keep the best masked correlation.
"""

import glob
import os
from pathlib import Path

TEMPLATE_DIR = Path(__file__).parent / "templates"
from dataclasses import dataclass

import cv2
import numpy as np

from .grid import COLS, NATIVE_PITCH, ROWS, Grid

# Correlation below this is not the token. Chosen from the score histogram: real
# tokens land at 0.6-0.95, the best non-token slot in our samples reaches ~0.35.
MATCH_THRESHOLD = 0.55


@dataclass
class Hit:
    token: str
    row: int
    col: int
    score: float


def load_templates(prefer_game_cut: bool = True) -> dict:
    """The 6 token icons.

    Templates cut from the client's own rendering (`build_icons.py`) score a flat
    1.000 on held-out screenshots -- the client draws each icon pixel-identically
    every time -- against 0.61-0.93 for the web prototype's artwork. We keep the
    prototype icons only as the bootstrap that located the tokens in the first
    place, and as a fallback.
    """
    if prefer_game_cut:
        game = _load_rgba(str(TEMPLATE_DIR), "token-")
        if len(game) == 6:
            return game
    raise FileNotFoundError(f"token templates missing from {TEMPLATE_DIR}")


def _load_rgba(path: str, prefix: str) -> dict:
    tpl = {}
    for f in sorted(glob.glob(os.path.join(path, f"{prefix}*.png"))):
        name = os.path.basename(f)[len(prefix) : -len(".png")]
        im = cv2.imread(f, cv2.IMREAD_UNCHANGED)
        if im is None or im.shape[2] != 4:
            raise ValueError(f"{f}: expected a 32-bit RGBA icon")
        tpl[name] = im
    return tpl


def score_grid(img: np.ndarray, g: Grid, templates: dict) -> np.ndarray:
    """(ROWS, COLS, n_tokens) array of per-slot correlations.

    The icon art is allowed to bleed a couple of pixels outside its slot, so a
    template confined strictly within one cell can never line up (this silently
    lost Blissful Fantasy Shard). Instead we correlate once across the whole grid
    at the single scale the grid gives us, then attribute each response to the
    cell its *centre* lands in. Scale stays pinned -- which is the constraint
    that matters -- while cell boundaries stop being a hard wall.
    """
    names = sorted(templates)
    scale = g.pitch / NATIVE_PITCH
    pad = int(round(0.35 * g.pitch))

    x0 = int(round(g.x)) - pad
    y0 = int(round(g.y)) - pad
    x1 = int(round(g.x + COLS * g.pitch)) + pad
    y1 = int(round(g.y + ROWS * g.pitch)) + pad
    x0, y0 = max(x0, 0), max(y0, 0)
    x1, y1 = min(x1, img.shape[1]), min(y1, img.shape[0])
    region = img[y0:y1, x0:x1]

    out = np.full((ROWS, COLS, len(names)), -1.0)
    for k, n in enumerate(names):
        icon = templates[n]
        if scale != 1.0:
            icon = cv2.resize(icon, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
        th, tw = icon.shape[:2]
        if th < 4 or tw < 4 or th >= region.shape[0] or tw >= region.shape[1]:
            continue

        mask = cv2.cvtColor(icon[:, :, 3], cv2.COLOR_GRAY2BGR)
        res = cv2.matchTemplate(region, icon[:, :, :3], cv2.TM_CCOEFF_NORMED, mask=mask)
        res[~np.isfinite(res)] = -1.0

        # Map every candidate placement to the slot holding the icon's centre.
        ii, jj = np.indices(res.shape)
        cy = y0 + ii + th / 2
        cx = x0 + jj + tw / 2
        rr = np.floor((cy - g.y) / g.pitch).astype(int)
        cc = np.floor((cx - g.x) / g.pitch).astype(int)
        ok = (rr >= 0) & (rr < ROWS) & (cc >= 0) & (cc < COLS)
        np.maximum.at(out[:, :, k], (rr[ok], cc[ok]), res[ok])
    return out


def find_tokens(img: np.ndarray, g: Grid, templates: dict) -> list[Hit]:
    """One hit per token: its best slot, if that beats the threshold.

    A token occupies at most one slot (the client stacks them), so we take an
    argmax per token rather than thresholding every cell -- that alone kills most
    would-be false positives.
    """
    names = sorted(templates)
    s = score_grid(img, g, templates)
    hits = []
    for k, n in enumerate(names):
        flat = int(np.argmax(s[:, :, k]))
        r, c = divmod(flat, COLS)
        if s[r, c, k] >= MATCH_THRESHOLD:
            hits.append(Hit(token=n, row=r, col=c, score=float(s[r, c, k])))
    return hits
