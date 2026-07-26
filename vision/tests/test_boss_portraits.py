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
