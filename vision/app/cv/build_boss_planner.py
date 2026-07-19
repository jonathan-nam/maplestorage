"""Cut the planner's two state glyphs from a labelled screenshot.

Mirrors build_font.py: the checkmark and arrow templates planner.py matches against are
extracted once, here, from a real capture, and committed. Boss identity does not need any
image asset, it is read from the name text (see planner.py), so this only produces the two
state glyphs.

Run from vision/:  python -m app.cv.build_boss_planner
"""

from pathlib import Path

import cv2

from . import planner as P

REPO = Path(__file__).resolve().parents[3]
SOURCE = REPO / "test-fixtures" / "planner" / "boss clear menu sample 2.png"

CHECK_ROW, ARROW_ROW = 0, 3  # a known cleared row and a known not-cleared row in SOURCE
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
    pw = panel.shape[1]

    def cut(band):
        a, b = band
        return panel[a:b, int(pw * GLYPH_X0) : int(pw * GLYPH_X1)]

    P.TEMPLATE_DIR.mkdir(exist_ok=True)
    cv2.imwrite(str(P.TEMPLATE_DIR / "planner-check.png"), cut(bands[CHECK_ROW]))
    cv2.imwrite(str(P.TEMPLATE_DIR / "planner-arrow.png"), cut(bands[ARROW_ROW]))
    print(f"wrote 2 state glyphs to {P.TEMPLATE_DIR}")


if __name__ == "__main__":
    main()
