"""Extract the client's stack-count digit font once, from a labelled screenshot.

The count is drawn in a small proportional bitmap font ('1' is 5px wide, '0' is
8px) with a hard black outline, and its light fill (~235) is nearly the same
value as the slot background (226), so no threshold separates fill from
background, and adjacent digits' outlines touch. The outline is the one reliable
signal, and the only place a glyph appears in isolation is a slot whose count is
a single digit. This panel happens to contain a single-digit count for nine of
the ten digits, so we lift the glyphs from those and take '0' from the tail of a
two-digit count, where its right side is at least free.

Each glyph is stored as a greyscale patch plus an alpha mask covering only its
own pixels, so correlating with the mask ignores icon art showing through behind.
"""

import os

import cv2
import numpy as np

from .grid import find_grid

BAND_TOP, BAND_BOT = 26, 40  # digit band, relative to the slot's top edge
GLYPH_H = (8, 13)  # a digit outline is ~11px tall
GLYPH_W = (3, 10)

# (digit, row, col, index of the glyph within that count, left-to-right).
EXEMPLARS = [
    ("1", 1, 0, 0),  # "1"
    ("3", 4, 12, 0),  # "3"
    ("4", 4, 6, 0),  # "4"
    ("5", 5, 2, 0),  # "5"
    ("6", 2, 2, 0),  # "6"
    ("8", 3, 1, 0),  # "8"
    ("9", 2, 3, 0),  # "9"
]

# 0, 2 and 7 have no isolated instance whose outline stays a separate blob: each
# fuses with a neighbouring digit or with icon art. Their boxes are read off the
# outline directly (all digits share the same y=3, h=11 band).
MANUAL = [
    ("0", 3, 4, (14, 3, 8, 11)),  # middle '0' of "1000"
    ("2", 2, 4, (2, 3, 8, 11)),  # leading '2' of "25"
    ("7", 1, 8, (4, 3, 8, 11)),  # "7", the diagonal to its right is icon art
]


def band(img, g, r, c):
    x, y, _, _ = g.cell(r, c)
    return img[y + BAND_TOP : y + BAND_BOT, x : x + 44]


def outline(patch):
    grey = cv2.cvtColor(patch, cv2.COLOR_BGR2GRAY)
    return (grey <= 80).astype(np.uint8)


def glyph_boxes(patch):
    """Boxes of the digit-shaped outline blobs in a count band, left to right."""
    n, _, stats, _ = cv2.connectedComponentsWithStats(outline(patch), connectivity=8)
    boxes = []
    for i in range(1, n):
        x, y, w, h, _ = stats[i]
        if GLYPH_H[0] <= h <= GLYPH_H[1] and GLYPH_W[0] <= w <= GLYPH_W[1]:
            boxes.append((x, y, w, h))
    return sorted(boxes)


def glyph_mask(patch, box):
    """The glyph's own pixels: its outline, plus the fill that outline encloses."""
    x, y, w, h = box
    sub = patch[y : y + h, x : x + w]
    dark = outline(sub)

    # Fill = light pixels the outline encloses. Flood from outside the outline;
    # whatever the flood cannot reach is interior, i.e. the digit's fill.
    #
    # Seed the flood from a padded background border, NOT from (0,0). A '5' or '7' has its top
    # stroke on the top-left corner, so (0,0) lands on the outline; floodFill seeded on an
    # already-set pixel fills nothing, and then every non-outline pixel reads as enclosed, so the
    # mask swallows the whole patch (a fully opaque glyph). That broke both the matchTemplate mask
    # for those two digits and the recoloured display copy, which drew a white box behind the count.
    bordered = cv2.copyMakeBorder(dark, 1, 1, 1, 1, cv2.BORDER_CONSTANT, value=0)
    cv2.floodFill(bordered, np.zeros((h + 4, w + 4), np.uint8), (0, 0), 1)
    ff = bordered[1:-1, 1:-1]
    enclosed = (ff == 0).astype(np.uint8)
    return ((dark | enclosed) * 255).astype(np.uint8), sub


def main():
    img = cv2.imread("../../reference-images/untradeables sample.png")
    g = find_grid(img)

    found = []
    for digit, r, c, idx in EXEMPLARS:
        boxes = glyph_boxes(band(img, g, r, c))
        if idx >= len(boxes):
            print(f"digit {digit}: r{r}c{c} -> only {len(boxes)} glyph boxes, skipped")
            continue
        found.append((digit, r, c, boxes[idx]))
    found += [(d, r, c, box) for d, r, c, box in MANUAL]
    found.sort()

    os.makedirs("out", exist_ok=True)
    sheet = []
    for digit, r, c, box in found:
        p = band(img, g, r, c)
        mask, sub = glyph_mask(p, box)
        grey = cv2.cvtColor(sub, cv2.COLOR_BGR2GRAY)
        cv2.imwrite(f"templates/digit_{digit}.png", cv2.merge([grey, grey, grey, mask]))
        print(f"digit {digit}: r{r}c{c} box={box} -> {box[2]}x{box[3]}")

        tile = cv2.cvtColor(cv2.bitwise_and(grey, mask), cv2.COLOR_GRAY2BGR)
        tile = cv2.resize(tile, (box[2] * 12, box[3] * 12), interpolation=cv2.INTER_NEAREST)
        tile = cv2.copyMakeBorder(tile, 2, 22, 2, 2, cv2.BORDER_CONSTANT, value=(0, 90, 0))
        cv2.putText(
            tile,
            digit,
            (4, tile.shape[0] - 6),
            cv2.FONT_HERSHEY_PLAIN,
            1.0,
            (255, 255, 255),
            1,
        )
        sheet.append(tile)

    h = max(t.shape[0] for t in sheet)
    sheet = [
        cv2.copyMakeBorder(t, 0, h - t.shape[0], 0, 0, cv2.BORDER_CONSTANT, value=(0, 90, 0))
        for t in sheet
    ]
    cv2.imwrite("out/font_sheet.png", cv2.hconcat(sheet))


if __name__ == "__main__":
    main()
