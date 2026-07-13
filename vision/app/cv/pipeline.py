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
import numpy as np

from .grid import NATIVE_PITCH, draw, find_grid
from .match import find_tokens, load_templates
from .ocr import load_font, read_count


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
# . Detail the capture threw away is gone, and the 11px count font is the first
# casualty, so undersampled input is rejected rather than quietly returning
# nulls.
MIN_PITCH = 44.0


# When find_grid fails we have to say something, and "this isn't a MapleStory inventory" is
# often a lie. A capture taken with Windows display scaling on is an inventory, the client
# drew it perfectly, it has just been upscaled and smeared on the way out, so the slot
# boundaries no longer resolve and the detector finds 6 boxes instead of 128. Telling that
# user their screenshot "isn't an inventory" sends them to fix the wrong thing entirely.
#
# The window's own chrome gives it away, and does so independently of scale, because it is
# about colour rather than geometry: a big field of near-neutral light grey (the #d1d4d6
# panel and #eee slot bed) plus the #36b8d0 cyan of the active tab. Measured across the
# corpus, a cropped inventory window scores 0.19-0.54 grey; a login screen, the character
# select and the Storage Room all score under 0.01.
INVENTORY_GREY_FRACTION = 0.15
INVENTORY_CYAN_FRACTION = 0.002


def looks_like_inventory_window(img) -> bool:
    """Whether this frame is the inventory window, judged on chrome colour alone.

    Only consulted when find_grid has already failed, to choose between "we cannot read
    this" and "this is not an inventory at all". Deliberately conservative: a full-desktop
    capture puts the window in a small corner of the frame and will not clear these bars, so
    it falls back to UNRECOGNIZED rather than guessing.
    """
    b, g, r = cv2.split(img.astype(np.int16))
    grey = (abs(b - g) < 8) & (abs(g - r) < 8) & (r > 195) & (r < 245)
    cyan = (abs(b - 208) < 30) & (abs(g - 184) < 30) & (abs(r - 54) < 40)
    return bool(grey.mean() > INVENTORY_GREY_FRACTION and cyan.mean() > INVENTORY_CYAN_FRACTION)


def normalize(img, g):
    """Undo an INTEGER upscale, the one resample that reverses without loss.

    MapleStory's UI Optimization, and Windows DPI scaling at 200%, both enlarge by exact
    pixel replication. Averaging each 2x2 block back down returns the client's original
    pixels bit for bit, so there is nothing to be gained by reading such a capture at its
    inflated scale, and something to be lost. Scaling a template up interpolates it
    smoothly, while the capture was enlarged blockily, and correlating a smooth glyph against
    a blocky one is a worse comparison than correlating the originals: at exact 2x it read a
    stack of 10 as 18, mistaking the '0' for an '8'.

    A FRACTIONAL scale has no such inverse. Resampling it to native is a lossy guess that
    destroys the count font, so those are read where they lie. See scale_templates().
    """
    ratio = g.pitch / NATIVE_PITCH
    if abs(ratio - round(ratio)) > 0.05 or round(ratio) < 2:
        return img, g
    img = cv2.resize(img, None, fx=1 / ratio, fy=1 / ratio, interpolation=cv2.INTER_AREA)
    return img, find_grid(img)


def parse(img, strict: bool = True):
    """Parse at the CAPTURE's own scale, unless that scale is losslessly reversible.

    normalize() used to resample EVERY non-native capture to 46px, and counts_trustworthy()
    then refused any capture whose scale was not an integer multiple, which is to say, it
    refused precisely the captures that the resample had just ruined. The refusal was
    calibrated against damage the parser was doing to itself.

    Now the frame is only resampled when that is lossless (an integer upscale), and otherwise
    the catalog is scaled up to meet it. A real Parsec capture at 1.33x, previously refused
    outright, yields every item and every count correctly.
    """
    g = find_grid(img)

    if strict and g.pitch < MIN_PITCH:
        raise Undersampled(
            f"slot pitch is {g.pitch:.1f}px, below the client's native "
            f"{NATIVE_PITCH:.0f}px, this capture was downscaled and the stack "
            "counts are no longer legible; upload at original resolution"
        )

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
            "needs_review": not digits,
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
            cv2.putText(
                vis,
                f"{name[:6]}={d['count']}",
                (x - 10, y - 4),
                cv2.FONT_HERSHEY_PLAIN,
                0.9,
                (0, 0, 255),
                1,
            )
        cv2.imwrite("out/pipeline.png", vis)
        print("\nwrote out/pipeline.png")
    return 0


if __name__ == "__main__":
    sys.exit(main())
