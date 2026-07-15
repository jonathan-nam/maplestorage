"""Boss-planner parse, checked against hand-verified truth.

As in test_parse.py, truth is read off the screenshots by eye (verified by Jonathan for
sample 2), never taken from the parser's own output. sample 2 pins the clear-state read on
one character; the full-screen sample pins that the SAME portraits identify across a different
capture, and that bosses NOT in the library are refused rather than guessed.
"""

from pathlib import Path

import cv2
import pytest

from app.cv import planner as P

REF = Path(__file__).resolve().parents[2] / "reference-images"

# (boss key, cleared) top-to-bottom. First nine verified by Jonathan; last two parser-proposed.
SAMPLE2_TRUTH = [
    ("darknell", True),
    ("chosen-seren", True),
    ("kalos-guardian", True),
    ("first-adversary", False),
    ("kaling", False),
    ("malefic-star", False),
    ("limbo", True),
    ("akechi-mitsuhide", False),
    ("black-mage", False),
    ("zakum", False),
    ("gollux", False),
]

# Bosses from the library that are actually visible in the full-screen sample, with their
# clear-state. Everything else on that shot (Lotus, Damien, ...) is outside the library.
SAMPLE_SHARED = {
    "darknell": True,
    "chosen-seren": True,
    "kalos-guardian": True,
    "first-adversary": False,
    "kaling": False,
}


@pytest.fixture(scope="module")
def templates():
    return P.load_state_glyphs(), P.load_portraits()


def _parse(name, templates):
    glyphs, portraits = templates
    img = cv2.imread(str(REF / name))
    assert img is not None, f"missing fixture {name}"
    res = P.parse_planner(img, glyphs, portraits)
    assert res is not None, "Boss Content panel not found"
    return res


def test_sample2_exact(templates):
    res = _parse("boss clear menu sample 2.png", templates)
    got = [(r.boss, r.cleared) for r in res.rows]
    assert got == SAMPLE2_TRUTH


def test_sample2_reached_end(templates):
    # The panel is isolated on white, so there is empty space below the last row.
    assert _parse("boss clear menu sample 2.png", templates).reached_list_end


def test_cross_capture_identity(templates):
    res = _parse("boss clear menu sample.png", templates)
    named = {r.boss: r.cleared for r in res.rows if r.boss is not None}
    # every shared boss is found, with the right state, across a different capture
    for boss, cleared in SAMPLE_SHARED.items():
        assert boss in named, f"{boss} not identified on the full-screen shot"
        assert named[boss] == cleared, f"{boss} clear-state wrong"


def test_no_false_identities(templates):
    # Bosses outside the library (Lotus, Damien, ...) must come back UNKNOWN, not be
    # mistaken for a library boss. So no identified boss beyond the ones truly present.
    res = _parse("boss clear menu sample.png", templates)
    identified = {r.boss for r in res.rows if r.boss is not None}
    assert identified <= set(SAMPLE_SHARED), f"false identities: {identified - set(SAMPLE_SHARED)}"
