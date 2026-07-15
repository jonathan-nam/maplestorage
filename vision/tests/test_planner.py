"""Boss-planner parse, checked against hand-verified truth.

As in test_parse.py, truth is read off the screenshots by eye (verified by Jonathan for
sample 2), never taken from the parser's own output. sample 2 pins the (boss, cleared) read
on one character; the full-screen sample pins that the name read identifies a full roster,
including bosses that a fixed image library would not have covered.
"""

from pathlib import Path

import cv2
import pytest

from app.cv import planner as P

REF = Path(__file__).resolve().parents[2] / "reference-images"

# (boss name, cleared) top-to-bottom. First nine verified by Jonathan; last two parser-proposed.
SAMPLE2_TRUTH = [
    ("Darknell", True),
    ("Chosen Seren", True),
    ("Kalos the Guardian", True),
    ("First Adversary", False),
    ("Kaling", False),
    ("Malefic Star", False),
    ("Limbo", True),
    ("Akechi Mitsuhide", False),
    ("Black Mage", False),
    ("Zakum", False),
    ("Gollux", False),
]

# Names visible on the full-screen shot. Includes bosses (Lotus, Damien, Lucid, Will, Verus
# Hilla) that no fixed portrait library was seeded with, the point of reading the name.
SAMPLE_EXPECTED = {
    "Lotus",
    "Damien",
    "Lucid",
    "Will",
    "Verus Hilla",
    "Darknell",
    "Chosen Seren",
    "Kalos the Guardian",
    "First Adversary",
    "Kaling",
}


@pytest.fixture(scope="module")
def glyphs():
    return P.load_state_glyphs()


def _parse(name, glyphs):
    img = cv2.imread(str(REF / name))
    assert img is not None, f"missing fixture {name}"
    res = P.parse_planner(img, glyphs)
    assert res is not None, "Boss Content panel not found"
    return res


def test_sample2_exact(glyphs):
    res = _parse("boss clear menu sample 2.png", glyphs)
    got = [(r.boss, r.cleared) for r in res.rows]
    assert got == SAMPLE2_TRUTH


def test_sample2_reached_end(glyphs):
    # The panel is isolated on white, so there is empty space below the last row.
    assert _parse("boss clear menu sample 2.png", glyphs).reached_list_end


def test_cross_capture_reads_roster(glyphs):
    res = _parse("boss clear menu sample.png", glyphs)
    named = {r.boss for r in res.rows if r.boss is not None}
    missing = SAMPLE_EXPECTED - named
    assert not missing, f"names not read on the full-screen shot: {missing}"
