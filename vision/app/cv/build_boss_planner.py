"""Cut the planner's state glyphs and boss portraits from a labelled screenshot.

Mirrors build_font.py: the templates planner.py matches against are extracted once, here,
from a real capture, and committed. The boss NAMES are the labelling step, proposed by the
parser and verified by a human (see the boss-clears direction note), so this script bakes in
a verified name per row of the source shot.

Run from vision/:  python -m app.cv.build_boss_planner
"""

from pathlib import Path

import cv2

from . import planner as P

REPO = Path(__file__).resolve().parents[3]
SOURCE = REPO / "reference-images" / "boss clear menu sample 2.png"

# Verified top-to-bottom for SOURCE. First nine confirmed by Jonathan; the two DAILY bosses
# (zakum, gollux) are parser-proposed and still want a human glance.
BOSSES = [
    "darknell",
    "chosen-seren",
    "kalos-guardian",
    "first-adversary",
    "kaling",
    "malefic-star",
    "limbo",
    "akechi-mitsuhide",
    "black-mage",
    "zakum",
    "gollux",
]
CHECK_ROW, ARROW_ROW = 0, 3  # a known cleared row and a known not-cleared row
GLYPH_X0, GLYPH_X1 = 0.86, 0.98  # cut the state glyph a touch inside its cell so it can slide


def main() -> None:
    img = cv2.imread(str(SOURCE))
    if img is None:
        raise SystemExit(f"cannot read {SOURCE}")
    box = P.find_panel(img)
    if box is None:
        raise SystemExit("Boss Content panel not found in source")
    x, y, w, h = box
    panel = img[y : y + h, x : x + w]
    bands = P._row_bands(panel)
    if len(bands) != len(BOSSES):
        raise SystemExit(f"source has {len(bands)} rows, {len(BOSSES)} labels")

    pw = panel.shape[1]

    def cut(band, x0, x1):
        a, b = band
        return panel[a:b, int(pw * x0) : int(pw * x1)]

    P.TEMPLATE_DIR.mkdir(exist_ok=True)
    cv2.imwrite(
        str(P.TEMPLATE_DIR / "planner-check.png"), cut(bands[CHECK_ROW], GLYPH_X0, GLYPH_X1)
    )
    cv2.imwrite(
        str(P.TEMPLATE_DIR / "planner-arrow.png"), cut(bands[ARROW_ROW], GLYPH_X0, GLYPH_X1)
    )
    for key, band in zip(BOSSES, bands):
        cv2.imwrite(
            str(P.TEMPLATE_DIR / f"boss-{key}.png"), cut(band, P.PORTRAIT_X0, P.PORTRAIT_X1)
        )
    print(f"wrote 2 state glyphs + {len(BOSSES)} portraits to {P.TEMPLATE_DIR}")


if __name__ == "__main__":
    main()
