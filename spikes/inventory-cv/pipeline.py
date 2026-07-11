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


class Undersampled(ValueError):
    """The capture holds less detail than the client drew; the count font is gone."""


# The client draws its UI at a fixed pixel size: the slot pitch measures 46px on
# every screenshot we have, across a 4x range of desktop resolutions. So the
# player's *game resolution* never changes the scale. What does change it is the
# capture: Windows display scaling, a HiDPI/Retina grab, stretched fullscreen, or
# a resize before upload.
#
# We can undo that, because the grid measures the pitch rather than assuming it:
# resample so the pitch lands back on 46 and everything downstream runs at native
# scale. That recovers an *upscaled* capture. It cannot recover a downscaled one
# -- detail the capture threw away is gone, and the 11px count font is the first
# casualty -- so undersampled input is rejected rather than quietly returning
# nulls.
MIN_PITCH = 44.0


def normalize(img, g):
    """Resample so the slot pitch is back at the client's native 46px."""
    if abs(g.pitch - NATIVE_PITCH) <= 0.5:
        return img, g
    k = NATIVE_PITCH / g.pitch
    # LANCZOS4 beats AREA/CUBIC here: it is the only kernel that keeps the count
    # font legible through a fractional rescale.
    img = cv2.resize(img, None, fx=k, fy=k, interpolation=cv2.INTER_LANCZOS4)
    return img, find_grid(img)


def counts_trustworthy(pitch: float) -> bool:
    """Whether the counts read off this capture can be believed without review.

    Icon detection survives any rescale -- the icons are large and distinctive.
    The counts do not. Measured on a synthetically rescaled screenshot:

        native (46px)     100%   any game resolution lands here
        1.5x / 2.0x       96-100%  HiDPI / integer scaling, recovers cleanly
        1.1x / 1.25x      70-77%   fractional Windows DPI scaling -- NOT reliable
        below native      rejected outright

    A fractional rescale interpolates the 11px font into mush and no resampling
    kernel brings it back, so rather than emit a plausible wrong number we mark
    the read as needing confirmation.
    """
    if abs(pitch - NATIVE_PITCH) <= 0.5:
        return True
    ratio = pitch / NATIVE_PITCH
    return abs(ratio - round(ratio)) <= 0.05 and round(ratio) >= 1


def parse(img, strict: bool = True):
    g = find_grid(img)

    if strict and g.pitch < MIN_PITCH:
        raise Undersampled(
            f"slot pitch is {g.pitch:.1f}px, below the client's native "
            f"{NATIVE_PITCH:.0f}px -- this capture was downscaled and the stack "
            "counts are no longer legible; upload at original resolution"
        )

    trusted = counts_trustworthy(g.pitch)
    img, g = normalize(img, g)
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
            "needs_review": not trusted or not digits,
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
