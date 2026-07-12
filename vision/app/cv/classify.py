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
# Candidates per slot handed to the verify stage.
#
# This was 3, chosen when the catalog was six tokens and the descriptor's recall@1 was 5/5.
# At thirteen items it started HIDING REAL ITEMS: Aurelia's Elixir sits in `untradeables
# sample.png` and matches its template at a pixel-perfect 1.000, and the shortlist never
# handed that template to the verifier at all. The item simply did not exist as far as the
# parser was concerned -- and, worse, the truth tables were built from the parser's own
# output, so they inherited the same blind spot and the tests happily agreed.
#
# Measured across the corpus at PNG/q95/q92/q85, against truth corrected by verifying EVERY
# template against every slot:
#
#     TOP_K=3   6/16 wrong     392ms
#     TOP_K=5   4/16 wrong     507ms
#     TOP_K=8   0/16 wrong     661ms
#     TOP_K=13  0/16 wrong     965ms   (exhaustive -- no better, just slower)
#
# The real lesson is about the descriptor, not the number: its ranking degrades as the
# catalog grows, and the true item can fall to rank 5 or beyond. 8 is comfortable at 13
# items and buys headroom, but this is THE thing to re-measure when the catalog grows --
# a shortlist that drops the right answer produces a silent undercount, which is the one
# failure this project exists to prevent.
TOP_K = 8
# A true match scores ~1.000, because the client renders every icon pixel-identically and
# the templates are cut from that rendering. Measured floor across the corpus from PNG down
# to JPEG q=75: 0.899.
#
# This was 0.55 for a long time, inherited from the era when templates were the web
# prototype's artwork -- which only reached 0.61 against the real thing, so the bar had to be
# low to catch it at all. Client-cut templates made that bar ~0.3 too generous, and nothing
# noticed until an item ARRIVED THAT WAS NOT IN THE CATALOG:
#
#   An Extreme GOLD Potion -- no template, we had never seen one -- scored 0.753 against the
#   Extreme GREEN template and was confidently reported as green. It is the same bottle in a
#   different colour, and gold is close enough to green in a*/b* (20.8, under the 30 bar) that
#   the colour gate let it through too. Neither test was wrong; the shape bar was simply so
#   low that "roughly the right bottle" cleared it.
#
# 0.80 sits between the 0.753 impostor and the 0.899 floor. The asymmetry is deliberate: it
# leaves more headroom above (missing a real token undercounts, silently) than below.
VERIFY_THRESHOLD = 0.80

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

NATIVE = 46  # the client's own slot size, and the size every template is cut at

# Regions that are not the item: the stack count (differs per screenshot) and
# the untradeable bar (per-item state, not identity).
_KEEP = np.ones((NATIVE, NATIVE), np.float32)
_KEEP[26:41, 0:44] = 0
_KEEP[40:, :] = 0


def _keep_mask(size: int) -> np.ndarray:
    if size == NATIVE:
        return _KEEP
    return cv2.resize(_KEEP, (size, size), interpolation=cv2.INTER_NEAREST)


def scale_templates(templates: dict, scale: float) -> dict:
    """Resize the catalog to the capture's scale, preserving alpha.

    This is the whole reason the parser now survives a rescaled capture, and the direction
    matters enormously. The old pipeline resampled the FRAME down to the native 46px pitch,
    which meant that on a capture arriving at 1.33x we threw away a third of every pixel we
    had been given -- and the 11px count font is the first thing to die. Measured on a real
    Parsec frame: matching at the captured scale identifies five items at 0.84-0.93 and reads
    all five stack counts correctly, while resampling the same frame to native drops two of
    those items below the 0.80 bar and reads no counts at all.

    Scaling the templates up instead costs one resize of ~13 small PNGs per parse and leaves
    the evidence intact. Interpolating a template is lossless in the way that matters: we are
    inventing detail in the thing we are searching FOR, not destroying detail in the thing we
    are searching IN.
    """
    if abs(scale - 1.0) < 0.01:
        return templates
    return {
        n: cv2.resize(t, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
        for n, t in templates.items()
    }


@dataclass
class SlotItem:
    name: str
    row: int
    col: int
    score: float


def _busy(cell: np.ndarray) -> float:
    """How much of a slot's interior is not backing. Near zero for an empty slot."""
    m = max(int(round(cell.shape[0] * 6 / NATIVE)), 1)
    g = cv2.cvtColor(cell[m:-m, m:-m], cv2.COLOR_BGR2GRAY)
    return float(((g < 214) | (g > 238)).mean())


def background(cells: dict, size: int = NATIVE) -> np.ndarray:
    """The slot backing, taken as the median of the empty slots in this frame."""
    empties = [c.astype(np.float32) for c in cells.values() if _busy(c) < 0.02]
    if not empties:
        # A completely full inventory: fall back to the flat backing colour.
        return np.full((size, size, 3), 226.0, np.float32)
    return np.median(np.stack(empties), axis=0)


def descriptor(cell: np.ndarray, bg: np.ndarray) -> np.ndarray:
    # Collapsing to DESC x DESC is what makes the descriptor scale-free: a 61px slot and a
    # 46px template land in the same 16x16 space, so the shortlist compares them directly
    # without either being resampled to the other.
    d = (cell.astype(np.float32) - bg).mean(axis=2) * _keep_mask(cell.shape[0])
    d = cv2.resize(d, (DESC, DESC), interpolation=cv2.INTER_AREA).ravel()
    d -= d.mean()
    n = np.linalg.norm(d)
    return d / n if n > 1e-6 else d


def slot_cells(img: np.ndarray, g: Grid) -> dict:
    p = round(g.pitch)
    out = {}
    for r in range(ROWS):
        for c in range(COLS):
            x, y, w, h = g.cell(r, c)
            cell = img[max(y, 0) : y + h, max(x, 0) : x + w]
            if cell.shape[:2] == (p, p):
                out[(r, c)] = cell
    return out


def build_catalog(templates: dict) -> tuple[list[str], np.ndarray]:
    """Descriptors for the catalog. Templates are full-slot RGBA crops."""
    names = sorted(templates)
    size = templates[names[0]].shape[0]
    bg = np.full((size, size, 3), 226.0, np.float32)
    mat = np.stack([descriptor(templates[n][:, :, :3], bg) for n in names])
    return names, mat


def _slot_window(img, g, r, c):
    """The slot, padded -- icon art bleeds a couple of pixels outside its cell, and a
    template confined strictly within the cell can never line up. The pad also absorbs the
    grid origin being a pixel or two out, which it routinely is on a rescaled capture."""
    x, y, w, h = g.cell(r, c)
    pad = max(int(round(6 * g.scale)), 6)
    return img[max(y - pad, 0) : y + h + pad, max(x - pad, 0) : x + w + pad]


# The colour gate. MapleStory is full of items that are the same artwork in a different
# colour -- the Extreme potions are one bottle in four -- and shape cannot tell them apart:
# Extreme Blue and Extreme Green correlate at 0.925 against a 0.55 bar.
#
# Colour is the mean a*/b* of the icon body in CIELAB. Measured across every item at every
# JPEG quality down to q=75, and counting only the candidates the SHAPE test already lets
# through -- which is the only set this gate ever sees:
#
#     worst distance on the CORRECT item : 20.6
#     closest distance on a WRONG item   : 41.4
#
# A bar of 30 sits in the middle of that gap. Note how badly shape does on its own here:
# it scores 0.86-0.93 matching the RED potion against the BLUE template. Colour is not a
# refinement, it is the entire basis of the decision.
#
# Hue was the obvious first choice and it does not work. A circular mean of hue over an icon
# is dominated by weakly-saturated glass and highlights, whose angle is essentially noise:
# the same blue bottle measured 157 degrees at JPEG q=92 and 109 at q=95, drifting towards
# green. JPEG stores chroma at half resolution, so on a 46px icon the hue smears. Mean a*/b*
# over the saturated body is stable precisely because averaging is what the subsampling
# already did.
MAX_LAB_DISTANCE = 30.0

# Below this saturation a pixel carries no useful colour -- greys and near-whites would drag
# the mean towards the middle of the space regardless of the item.
MIN_SATURATION = 60


def _colour_pixels(tpl: np.ndarray) -> np.ndarray:
    """Which pixels of the template carry real colour. Computed from the TEMPLATE, never
    from the screenshot -- see _colour_distance."""
    hsv = cv2.cvtColor(tpl[:, :, :3], cv2.COLOR_BGR2HSV)
    return (tpl[:, :, 3] > 0) & (hsv[:, :, 1] > MIN_SATURATION)


def _mean_ab(bgr: np.ndarray, sel: np.ndarray) -> np.ndarray:
    lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB)
    return np.array([lab[:, :, 1][sel].mean(), lab[:, :, 2][sel].mean()], np.float32)


def _colour_distance(tpl: np.ndarray, patch: np.ndarray) -> float | None:
    """How far the matched pixels are from the template in colour. None when the icon is
    essentially greyscale, in which case colour has nothing to say and shape decides alone.

    **Which pixels to average is decided by the template, not the screenshot.** That is the
    whole trick, and getting it wrong is what made the first attempt fail: selecting by the
    screenshot's own saturation meant JPEG -- which crushes saturation -- changed the
    selection itself, so on a small icon the average drifted onto contaminated edge pixels.
    The red potion then sat 35.8 from its own template and 25.0 from the blue one, and got
    called blue.

    The template is clean PNG and never changes, so it makes a stable stencil. Only the
    values are read from the screenshot.
    """
    sel = _colour_pixels(tpl)
    if int(sel.sum()) < 20:
        return None
    return float(np.linalg.norm(_mean_ab(tpl[:, :, :3], sel) - _mean_ab(patch, sel)))


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

    _, score, _, loc = cv2.minMaxLoc(res)
    if score < VERIFY_THRESHOLD:
        return float(score)

    # Shape says yes. Now check the colour, because shape ALONE cannot tell an Extreme Blue
    # Potion from an Extreme Green one: same bottle, different colour, correlating at 0.925
    # against a 0.55 bar. The right one wins by 0.075, which is luck rather than a decision,
    # and it would flip silently the day the client nudged the art.
    #
    # The two tests are complementary, and each covers the other's blind spot. Colour
    # separates blue from green (a*b* distance 61) where shape cannot. Shape separates the
    # blue potion from kalos-token (near-identical colour) where colour cannot. Neither is
    # sufficient alone; together nothing gets through.
    patch = win[loc[1] : loc[1] + th, loc[0] : loc[0] + tw]
    d = _colour_distance(tpl, patch)
    if d is not None and d > MAX_LAB_DISTANCE:
        return -1.0

    return float(score)


def classify(img: np.ndarray, g: Grid, templates: dict) -> list[SlotItem]:
    # The catalog is brought to the capture's scale, never the other way round. The
    # descriptor shortlist is scale-free (everything collapses to 16x16), but the verify
    # stage is a pixel correlation and needs the template to be the size of the thing in
    # the frame.
    templates = scale_templates(templates, g.scale)
    names, cat = build_catalog(templates)
    cells = slot_cells(img, g)
    bg = background(cells, round(g.pitch))

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
