"""The original whole-grid token matcher. Superseded for the service by classify.py.

Kept because build_icons and the CLI still use score_grid to LOCATE a known template, which is
a different job from deciding what an unknown slot holds.

find_tokens takes an argmax per token, so it can only ever report ONE slot per item -- which is
wrong now that an item can occupy two (a symbol coupon exists tradeable and untradeable, with
identical pixels). The service does not use it; main.py sums across slots instead.
"""

import glob
import os
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

from .classify import scale_templates
from .grid import COLS, NATIVE_PITCH, ROWS, Grid

TEMPLATE_DIR = Path(__file__).parent / "templates"

# Correlation below this is not the token. Chosen from the score histogram: real
# tokens land at 0.6-0.95, the best non-token slot in our samples reaches ~0.35.
# Only used to locate a template we already know is there, so a slack bar is fine. Do NOT reuse
# this number to decide what an unknown slot holds -- classify.VERIFY_THRESHOLD is 0.80, because
# an out-of-catalog item scored 0.753 against the wrong template.
MATCH_THRESHOLD = 0.55


@dataclass
class Hit:
    token: str
    row: int
    col: int
    score: float


def load_templates() -> dict:
    """Every catalog icon on disk.

    Templates are cut from the client's own rendering (build_icons.py) and score a flat 1.000 on
    held-out screenshots, because the client draws each icon pixel-identically every time.

    Deliberately does NOT check the count. It used to say `if len(game) == 6`, which was a lie the
    moment a seventh item existed -- it raised "templates missing" with all thirteen sitting on
    disk. Manifest/template agreement is the real invariant and is checked in tests/test_catalog.py.
    """
    game = _load_rgba(str(TEMPLATE_DIR), "token-")
    if not game:
        raise FileNotFoundError(f"no token templates in {TEMPLATE_DIR}")
    return game


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
    # The frame is never resampled to meet the catalog any more; the catalog is resampled to
    # meet the frame. See classify.scale_templates for why that direction is the whole trick.
    templates = scale_templates(templates, g.scale)
    names = sorted(templates)
    s = score_grid(img, g, templates)
    hits = []
    for k, n in enumerate(names):
        flat = int(np.argmax(s[:, :, k]))
        r, c = divmod(flat, COLS)
        if s[r, c, k] >= MATCH_THRESHOLD:
            hits.append(Hit(token=n, row=r, col=c, score=float(s[r, c, k])))
    return hits
