"""Cut every boss's own planner portrait out of a labelled capture.

Mirrors build_boss_planner.py and build_font.py: the art ships as committed assets extracted
once, here, from a real capture rather than drawn or downloaded.

The portraits come from the PLANNER, not from maplestory.io. The mirror can render mob sprites
for most bosses but not for First Adversary, Malefic Star or Gloom (all newer than the last GMS
version whose mob art renders, v255), and a mob render is a full-body chibi that has to be cropped
to a face before it reads at 26px. The planner already draws the exact portrait the game uses, at
the exact size, for every boss including those three. So this reads the game's own answer.

Run from vision/:  python -m app.cv.build_boss_portraits
"""

from pathlib import Path

import cv2
import numpy as np

from . import planner as P

REPO = Path(__file__).resolve().parents[3]
SOURCE = REPO / "test-fixtures" / "planner" / "boss portraits sample.png"
OUT = REPO / "backend" / "src" / "main" / "resources" / "seed-assets" / "bosses"

# The capture holds two planner windows side by side, scrolled to different points, because no
# single scroll position shows all seventeen rows. Split down the middle and read each.
#
# Rows are listed in the order they appear, NOT matched by OCR: pytesseract is a vision-service
# dependency and this is a build script, and the capture is fixed, so the order is a fact about
# this file. The row counts are asserted below, which is what catches the capture being replaced
# with a differently scrolled one.
LEFT_ROWS = [
    "black-mage",
    "lotus",
    "damien",
    "guardian-angel-slime",
    "lucid",
    "will",
    "gloom",
    "verus-hilla",
    "darknell",
    "chosen-seren",
    "kalos-the-guardian",
]
RIGHT_ROWS = [
    "lucid",
    "will",
    "gloom",
    "verus-hilla",
    "darknell",
    "chosen-seren",
    "kalos-the-guardian",
    "first-adversary",
    "kaling",
    "malefic-star",
    "limbo",
    "baldrix",
    # On the planner, absent from catalog/bosses.yaml. Skipped with a line of output rather than
    # in silence: an unlisted boss is a row the reader cannot name, which reads as an unreadable
    # row, which makes a parse warn that it may have missed something.
    "jupiter",
]

# The portrait's box within a row, measured off this capture: columns 16-42 of a 329px panel, and
# 13px either side of the state glyph's band centre. Fractions rather than pixels so a capture at
# another scale still cuts the same thing.
PORTRAIT_X0, PORTRAIT_X1 = 0.049, 0.128
PORTRAIT_HALF_H = 0.76  # of the state glyph band's height

# A second copy of each portrait for the one place that draws it BIGGER than the game does.
#
# The planner portrait is 26px and that is the ceiling: the client's UI is fixed-size bitmaps, so
# no capture yields more. Run Order draws it in a 40px box, and 26->40 nearest-neighbour is the
# combination globals.css already warns against, uneven row duplication that puts a step in every
# straight edge. Scaling in the browser instead only trades the steps for blur.
#
# So scale once here, with a filter that knows it is pixel art, and let the browser DOWNSCALE.
# 80px is 2x the 40px box: a 1x screen gets an exact 2:1 reduction and a 2x screen gets 1:1, so
# neither has to invent anything. Same principle as the item icons in catalog/build.py.
RUN_ART_PX = 80
RUN_ART_SUFFIX = "@2x"


def scale2x(a: np.ndarray) -> np.ndarray:
    """EPX/Scale2x: double a pixel-art image without softening it.

    Each pixel becomes four. A corner is replaced by its neighbour only where the two orthogonal
    neighbours meeting at it agree AND the two axes disagree, which rounds a staircase and leaves
    flat runs and 1px details alone. Chosen over a bicubic upscale (blurs the linework) and over
    hqx/xBRZ (a build-time dependency for a result these 26px tiles do not visibly separate from
    this one).
    """
    h, w = a.shape[:2]
    p = np.pad(a, ((1, 1), (1, 1), (0, 0)), mode="edge")
    centre = p[1 : h + 1, 1 : w + 1]
    up, down = p[0:h, 1 : w + 1], p[2 : h + 2, 1 : w + 1]
    left, right = p[1 : h + 1, 0:w], p[1 : h + 1, 2 : w + 2]

    same = lambda x, y: np.all(x == y, axis=-1)[..., None]  # noqa: E731
    # Both axes must have contrast, else this is a flat run and nothing should move.
    live = ~same(left, right) & ~same(up, down)

    out = np.empty((h * 2, w * 2, a.shape[2]), a.dtype)
    out[0::2, 0::2] = np.where(same(left, up) & live, left, centre)
    out[0::2, 1::2] = np.where(same(up, right) & live, right, centre)
    out[1::2, 0::2] = np.where(same(down, left) & live, left, centre)
    out[1::2, 1::2] = np.where(same(right, down) & live, right, centre)
    return out


def run_art(tile: np.ndarray) -> np.ndarray:
    """The 26px portrait as the 80px asset Run Order draws. Up in pixel-art steps, then down."""
    big = scale2x(scale2x(tile))  # 26 -> 52 -> 104
    return cv2.resize(big, (RUN_ART_PX, RUN_ART_PX), interpolation=cv2.INTER_AREA)


def _portraits(half, keys: list[str]) -> dict[str, "cv2.typing.MatLike"]:
    box = P.find_panel(half)
    if box is None:
        raise SystemExit("Boss Content panel not found in one half of the source")
    x, y, w, h = box
    panel = half[y : y + h, x : x + w]
    rows = P._detect_rows(panel, P.load_state_glyphs())
    if len(rows) != len(keys):
        raise SystemExit(
            f"expected {len(keys)} rows in this panel, detected {len(rows)}: {SOURCE.name} changed"
        )

    cut = {}
    for (a, b, _, _), key in zip(rows, keys, strict=True):
        cy = (a + b) // 2
        half_h = int(round((b - a) * PORTRAIT_HALF_H))
        cut[key] = panel[cy - half_h : cy + half_h, int(w * PORTRAIT_X0) : int(w * PORTRAIT_X1)]
    return cut


def main() -> None:
    img = cv2.imread(str(SOURCE))
    if img is None:
        raise SystemExit(f"cannot read {SOURCE}")
    mid = img.shape[1] // 2

    portraits = _portraits(img[:, :mid], LEFT_ROWS)
    # The right panel repeats seven of the left's rows. Same portrait either way, so first wins.
    for key, tile in _portraits(img[:, mid:], RIGHT_ROWS).items():
        portraits.setdefault(key, tile)

    # TRACKED bosses only. The generated catalog also carries the untracked ones (Zakum, Gollux,
    # Akechi Mitsuhide) so the reader can name their planner rows, but nothing draws them, so an
    # asset for them would be art no UI asks for.
    catalog = {b["key"] for b in P.load_boss_catalog() if b.get("tracked", True)}
    OUT.mkdir(parents=True, exist_ok=True)
    written = 0
    for key, tile in sorted(portraits.items()):
        if key not in catalog:
            print(f"  skipped {key}: on the planner, not in catalog/bosses.yaml")
            continue
        cv2.imwrite(str(OUT / f"{key}.png"), tile)
        cv2.imwrite(str(OUT / f"{key}{RUN_ART_SUFFIX}.png"), run_art(tile))
        written += 1
    print(f"wrote {written} boss portraits (and {RUN_ART_SUFFIX}) to {OUT.relative_to(REPO)}")


if __name__ == "__main__":
    main()
