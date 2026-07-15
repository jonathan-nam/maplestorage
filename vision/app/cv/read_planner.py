"""Run a Maple Planner screenshot through the boss-clears reader and show the result.

A dev tool for eyeballing the parse on your own captures, before it is wired into /parse.
Prints the (boss, cleared) rows and writes an annotated copy beside each input so you can
see exactly which rows and states were read.

Run from vision/:
    python -m app.cv.read_planner "path/to/planner.png" [more.png ...]

A boss whose name is not in the catalog list, or that could not be read, shows as UNKNOWN
(by design, it refuses rather than guesses).
"""

import sys
from pathlib import Path

import cv2

from . import planner as P

GREEN = (60, 170, 60)
RED = (40, 40, 210)


def annotate(img, result):
    out = img.copy()
    px, _, pw, _ = result.panel
    label_x = min(px + pw + 12, img.shape[1] - 260)  # in the margin, clear of the panel text
    for r in result.rows:
        colour = GREEN if r.cleared else RED
        label = r.boss if r.boss else f"UNKNOWN {r.name_score:.2f}"
        mark = "cleared" if r.cleared else "pending"
        cv2.rectangle(out, (px, r.y0), (px + pw, r.y1), colour, 2)
        cv2.putText(
            out,
            f"{label}  ({mark})",
            (label_x, (r.y0 + r.y1) // 2 + 5),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.55,
            colour,
            1,
            cv2.LINE_AA,
        )
    return out


def run(path: str, glyphs) -> bool:
    img = cv2.imread(path)
    if img is None:
        print(f"{path}: cannot read image")
        return False
    result = P.parse_planner(img, glyphs)
    name = Path(path).name
    if result is None:
        print(f"{name}: no Boss Content panel found")
        return False
    end = "yes" if result.reached_list_end else "no (scroll for more)"
    print(f"\n{name}  ·  {len(result.rows)} rows  ·  reached list end: {end}")
    for i, r in enumerate(result.rows, 1):
        boss = r.boss if r.boss else f"<UNKNOWN {r.name_score:.2f}>"
        state = "cleared" if r.cleared else "pending"
        print(f"  {i:2d}  {boss:24s} {state}")
    out_path = str(Path(path).with_suffix(".annotated.png"))
    cv2.imwrite(out_path, annotate(img, result))
    print(f"  annotated -> {out_path}")
    return True


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__)
        return 2
    glyphs = P.load_state_glyphs()
    ok = all(run(p, glyphs) for p in argv)
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
