"""The boss portraits shipped as seed assets, and the capture they are cut from.

build_boss_portraits.py maps planner rows to boss keys BY ORDER, so the thing that can silently
go wrong is the capture being replaced by one scrolled somewhere else: every portrait would then
be filed under the wrong boss, and every one of them would still look like a real boss. These
tests pin the row counts the mapping assumes, and that the committed assets match what the builder
cuts today.
"""

import cv2
import numpy as np
import pytest
from fixtures import PLANNER

from app.cv import build_boss_portraits as B
from app.cv import planner as P

SOURCE = PLANNER / "boss portraits sample.png"


def _tracked() -> set[str]:
    """The bosses anything draws. The catalog also names the untracked ones for the reader."""
    return {b["key"] for b in P.load_boss_catalog() if b.get("tracked", True)}


@pytest.fixture(scope="module")
def capture():
    img = cv2.imread(str(SOURCE))
    assert img is not None, f"missing fixture {SOURCE}"
    return img


def test_each_panel_has_the_rows_the_key_order_assumes(capture):
    mid = capture.shape[1] // 2
    glyphs = P.load_state_glyphs()
    for half, keys in ((capture[:, :mid], B.LEFT_ROWS), (capture[:, mid:], B.RIGHT_ROWS)):
        box = P.find_panel(half)
        assert box is not None
        x, y, w, h = box
        rows = P._detect_rows(half[y : y + h, x : x + w], glyphs)
        assert len(rows) == len(keys)


def test_every_tracked_boss_has_a_committed_portrait():
    # A missing asset is a boss drawn with no art in a UI that shows art for its neighbours, and
    # the catalog check (catalog/build.py) fails on it too. Kept here as well because this is the
    # side that would notice a capture losing a row.
    tracked = _tracked()
    missing = sorted(key for key in tracked if not (B.OUT / f"{key}.png").exists())
    assert missing == []


def test_the_committed_assets_are_what_the_builder_cuts_today(capture):
    mid = capture.shape[1] // 2
    cut = B._portraits(capture[:, :mid], B.LEFT_ROWS)
    for key, tile in B._portraits(capture[:, mid:], B.RIGHT_ROWS).items():
        cut.setdefault(key, tile)

    for key in sorted(_tracked()):
        committed = cv2.imread(str(B.OUT / f"{key}.png"))
        assert committed is not None, key
        # Identical, not merely similar: these are lossless crops of a fixed capture, so any
        # difference means the crop box or the row mapping moved.
        assert np.array_equal(committed, cut[key]), key


def test_every_tracked_boss_has_a_committed_run_art():
    # The 26px asset and the 80px one are drawn in different places, so a boss with only the first
    # loses its art on Run Order and nowhere else. catalog/build.py checks for both too.
    missing = sorted(
        key for key in _tracked() if not (B.OUT / f"{key}{B.RUN_ART_SUFFIX}.png").exists()
    )
    assert missing == []


def test_the_committed_run_art_is_what_the_builder_makes_today():
    for key in sorted(_tracked()):
        tile = cv2.imread(str(B.OUT / f"{key}.png"))
        committed = cv2.imread(str(B.OUT / f"{key}{B.RUN_ART_SUFFIX}.png"))
        assert committed is not None, key
        assert committed.shape[:2] == (B.RUN_ART_PX, B.RUN_ART_PX), key
        assert np.array_equal(committed, B.run_art(tile)), key


def test_run_art_is_an_exact_multiple_of_the_box_it_is_drawn_in():
    # 80px is 2x the 40px .run-art box, which is what keeps the browser reducing by exactly 2:1
    # (or 1:1 on a 2x screen) instead of enlarging 26px art by 1.54 and stepping every edge.
    assert B.RUN_ART_PX % 40 == 0


def test_scale2x_leaves_a_flat_image_flat():
    # The guard against the rounding rule firing on its own: with no contrast there is no corner
    # to round, and every output pixel must be the input colour.
    flat = np.full((6, 6, 3), 200, np.uint8)
    assert np.array_equal(B.scale2x(flat), np.full((12, 12, 3), 200, np.uint8))


def test_scale2x_keeps_every_original_pixel_somewhere_in_its_block():
    # Scale2x may round a corner, but it must never invent a colour: each output pixel is one of
    # the five it read. This is what separates it from a bicubic upscale, and it is the property
    # that makes the result still look like the game's own art.
    src = cv2.imread(str(B.OUT / "lucid.png"))
    out = B.scale2x(src)
    assert out.shape == (src.shape[0] * 2, src.shape[1] * 2, 3)
    src_colours = {tuple(c) for c in src.reshape(-1, 3)}
    out_colours = {tuple(c) for c in out.reshape(-1, 3)}
    assert out_colours <= src_colours


def test_the_repeated_rows_agree_between_the_two_panels(capture):
    # Seven bosses appear in both windows. The builder keeps the left one; if the two disagreed,
    # "first wins" would be a coin toss rather than a shortcut.
    mid = capture.shape[1] // 2
    left = B._portraits(capture[:, :mid], B.LEFT_ROWS)
    right = B._portraits(capture[:, mid:], B.RIGHT_ROWS)
    shared = sorted(set(left) & set(right))
    assert len(shared) == 7
    for key in shared:
        # Not byte-identical: the two windows sit on different backgrounds and a handful of edge
        # pixels blend one value apart. Same art, so a difference beyond that would mean the rows
        # do not line up with the keys.
        assert np.abs(left[key].astype(int) - right[key].astype(int)).max() <= 1, key
