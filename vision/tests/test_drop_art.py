"""The drop icons shipped as seed assets.

The frontend paints these 1:1 in a 46px box, so nothing downstream can correct art that is the
wrong size or sits in the wrong place on the canvas. catalog/build.py --check already refuses a
file that is not 46x46. What it cannot see is art that is the right size and misregistered, which
is the risk on a hand cut: `eternal-armor-of-radiance-box` was cut from a capture taken on black,
and the black had swallowed the chest outline. The outline came back from the silhouette its five
siblings share, so that sharing is load-bearing and is pinned here.
"""

import pathlib

import cv2
import numpy as np
import pytest

ROOT = pathlib.Path(__file__).resolve().parents[2]
DROP_ICONS = ROOT / "backend" / "src" / "main" / "resources" / "seed-assets" / "drops"

# One chest, six contents. Five come from the mirror; the sixth is the hand cut.
MIRROR_BOXES = [
    "eternal-armor-of-desire-box",
    "divine-eternal-armor-box",
    "ferocious-beast-eternal-armor-box",
    "ancient-eternal-armor-box",
    "eternal-armor-of-oaths-box",
]
CUT_BOX = "eternal-armor-of-radiance-box"
# The one the cut borrowed its silhouette from, so the two are comparable pixel for pixel.
DONOR = "eternal-armor-of-oaths-box"


def _alpha(key: str) -> np.ndarray:
    icon = cv2.imread(str(DROP_ICONS / f"{key}.png"), cv2.IMREAD_UNCHANGED)
    assert icon is not None, key
    assert icon.shape == (46, 46, 4), f"{key} is {icon.shape}"
    return icon[:, :, 3]


@pytest.mark.parametrize("key", MIRROR_BOXES[1:])
def test_the_mirror_armor_boxes_are_one_chest(key):
    assert np.array_equal(_alpha(key) > 0, _alpha(MIRROR_BOXES[0]) > 0)


def test_the_hand_cut_box_registers_with_that_chest():
    # Its opaque core, not its footprint: the radiance box glows past the chest and the mirror ones
    # do not, so a shared footprint would be the wrong thing to ask for. A cut re-made at another
    # offset moves the core and fails here.
    assert np.array_equal(_alpha(CUT_BOX) == 255, _alpha(DONOR) == 255)


def test_the_hand_cut_box_kept_its_glow():
    # The guard on the test above being satisfied by pasting the donor's alpha over the cut. The
    # glow is the part of the capture no sibling could have supplied.
    alpha = _alpha(CUT_BOX)
    assert ((alpha > 0) & (alpha < 255)).sum() > 200
    assert (alpha > 0).sum() > (_alpha(DONOR) > 0).sum()
