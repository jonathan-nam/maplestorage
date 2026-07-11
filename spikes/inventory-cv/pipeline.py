"""End-to-end: screenshot in, {token: count} out. No LLM involved.

    find_grid  -> the 16x8 slot lattice, which also pins the screenshot's scale
    find_tokens-> which slot holds each of the 6 catalog icons, at that scale
    read_count -> the stack count in those slots, via the client's digit font

Run:  python pipeline.py <screenshot.png> [--debug]
"""

import json
import os
import sys

import cv2

from grid import NATIVE_PITCH, find_grid, draw
from match import find_tokens, load_templates
from ocr import load_font, read_count


class RescaledScreenshot(ValueError):
    """The screenshot was resized, so the 11px count font is no longer legible."""


def parse(img, strict: bool = False):
    g = find_grid(img)

    # The grid detector recovers any pitch, but the stages after it do not
    # tolerate one: an 11px bitmap font does not survive resampling, and at 0.95x
    # every count already reads as garbage. Anything but the client's native 46px
    # pitch has to fail loudly rather than quietly return nulls.
    if strict and abs(g.pitch - NATIVE_PITCH) > 1.0:
        raise RescaledScreenshot(
            f"slot pitch is {g.pitch:.1f}px, expected {NATIVE_PITCH:.0f}px -- "
            "the screenshot has been rescaled; upload it at original resolution"
        )

    tokens = load_templates()
    font = load_font()

    out = {}
    for hit in find_tokens(img, g, tokens):
        digits, conf = read_count(img, g, hit.row, hit.col, font)
        out[hit.token] = {
            "count": int(digits) if digits else None,
            "slot": [hit.row, hit.col],
            "icon_score": round(hit.score, 3),
            "count_confidence": round(conf, 3),
        }
    return g, out


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    path = sys.argv[1]
    img = cv2.imread(path)
    if img is None:
        print(f"cannot read {path}")
        return 1

    g, out = parse(img, strict="--strict" in sys.argv)
    print(f"# {path}  ({img.shape[1]}x{img.shape[0]})")
    print(f"# grid: pitch={g.pitch:.1f}px scale={g.scale:.2f} from {g.n_cells} slots\n")
    print(json.dumps(out, indent=2))

    os.makedirs("out", exist_ok=True)
    if "--debug" in sys.argv:
        vis = draw(img, g)
        for name, d in out.items():
            r, c = d["slot"]
            x, y, w, h = g.cell(r, c)
            cv2.rectangle(vis, (x, y), (x + w, y + h), (0, 0, 255), 2)
            cv2.putText(vis, f'{name[:6]}={d["count"]}', (x - 10, y - 4),
                        cv2.FONT_HERSHEY_PLAIN, 0.9, (0, 0, 255), 1)
        cv2.imwrite("out/pipeline.png", vis)
        print("\nwrote out/pipeline.png")
    return 0


if __name__ == "__main__":
    sys.exit(main())
