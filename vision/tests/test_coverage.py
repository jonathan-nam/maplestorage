"""Can we tell a complete view of the inventory from a partial one?

This is the gate that lets the backend clear a count it did not hear about, so its two
failure directions are not symmetric. Calling a partial view COMPLETE deletes stacks the
player still holds. Calling a complete view PARTIAL only leaves a stale count in place,
which is what already happens today. So every threshold here is set to fail toward PARTIAL.

The bug that prompted this: two screenshots of one character, each detecting 24 items, each
missing one the other found. Treating absence as zero on either would have wiped a real 830.
"""

import cv2
import pytest

from app.cv.grid import COLS, MIN_SLOT_GREY, ROWS, coverage, find_grid

REF = "../reference-images"

# Every capture in the corpus that IS a readable inventory. Each must read as complete:
# if a genuine capture cannot clear this gate, the feature never fires for anyone.
COMPLETE_CAPTURES = [
    f"{REF}/inventory sample.png",
    f"{REF}/inventory smaller.png",
    f"{REF}/inventory804x550.png",
    f"{REF}/potions.png",
    f"{REF}/symbols.png",
    f"{REF}/untradeables sample.png",
    f"{REF}/untradebles description sample.png",
    f"{REF}/symbols-parsec.png",
]

# Real MapleStory UI, used as occluders. A synthetic grey rectangle would be a softer test
# than the thing that actually happens, which is another game window over the inventory.
OCCLUDERS = [
    f"{REF}/boss planner.png",
    f"{REF}/boss matrix.png",
    f"{REF}/login screen.png",
    f"{REF}/storage image.png",
]


def _load(path):
    img = cv2.imread(path, cv2.IMREAD_COLOR)
    assert img is not None, f"missing fixture {path}"
    return img


def _occlude(base, g, occluder, rows, cols, at=(2, 2)):
    """Paste a real window over `rows` x `cols` slots of the lattice."""
    out = base.copy()
    p = round(g.pitch)
    x0, y0 = g.cell(*at)[:2]
    h, w = rows * p, cols * p
    occ = _load(occluder)
    if occ.shape[0] < h or occ.shape[1] < w:
        occ = cv2.resize(occ, (max(w, occ.shape[1]), max(h, occ.shape[0])))
    out[y0 : y0 + h, x0 : x0 + w] = occ[:h, :w]
    return out


@pytest.mark.parametrize("path", COMPLETE_CAPTURES)
def test_a_genuine_inventory_reads_as_complete(path):
    img = _load(path)
    cov = coverage(img, find_grid(img))
    assert cov.complete, f"{path}: {cov.off_frame} off-frame, {cov.occluded} occluded"


@pytest.mark.parametrize("path", COMPLETE_CAPTURES)
@pytest.mark.parametrize("quality", [90, 80, 70])
def test_completeness_survives_jpeg(path, quality):
    """A re-encoded upload must not lose the right to clear stale counts."""
    _, buf = cv2.imencode(".jpg", _load(path), [cv2.IMWRITE_JPEG_QUALITY, quality])
    img = cv2.imdecode(buf, cv2.IMREAD_COLOR)
    assert coverage(img, find_grid(img)).complete


@pytest.mark.parametrize("occluder", OCCLUDERS)
def test_a_window_over_the_inventory_is_not_complete(occluder):
    """The occlusion undercount, caught rather than silently absorbed."""
    base = _load(f"{REF}/inventory sample.png")
    g = find_grid(base)
    img = _occlude(base, g, occluder, rows=4, cols=8)
    cov = coverage(img, find_grid(img))
    assert not cov.complete
    assert cov.occluded == 32, f"expected 32 covered slots, flagged {cov.occluded}"


def test_even_one_covered_slot_is_not_complete():
    """One hidden slot is one item that could be wrongly zeroed."""
    base = _load(f"{REF}/inventory sample.png")
    g = find_grid(base)
    img = _occlude(base, g, OCCLUDERS[0], rows=1, cols=1)
    cov = coverage(img, find_grid(img))
    assert cov.occluded == 1
    assert not cov.complete


@pytest.mark.parametrize("slots", [1, 2, 3])
def test_a_crop_into_the_lattice_is_not_complete(slots):
    """Cropping to the window is supported and stays complete. Cropping INTO the slots
    is not, and each lost row is 16 slots, each lost column 8."""
    base = _load(f"{REF}/inventory sample.png")
    g = find_grid(base)
    p = round(g.pitch)
    x0, y0 = g.cell(0, 0)[:2]
    x1 = g.cell(ROWS - 1, COLS - 1)[0] + p
    y1 = g.cell(ROWS - 1, COLS - 1)[1] + p
    pad = 8

    tight = base[max(y0 - pad, 0) : y1 + pad, max(x0 - pad, 0) : x1 + pad]
    assert coverage(tight, find_grid(tight)).complete, "a tight crop is still a full view"

    short = base[max(y0 - pad, 0) : y1 - slots * p, max(x0 - pad, 0) : x1 + pad]
    cov = coverage(short, find_grid(short))
    assert not cov.complete
    assert cov.off_frame == slots * COLS

    narrow = base[max(y0 - pad, 0) : y1 + pad, max(x0 - pad, 0) : x1 - slots * p]
    cov = coverage(narrow, find_grid(narrow))
    assert not cov.complete
    assert cov.off_frame == slots * ROWS


def test_the_threshold_keeps_its_margin():
    """MIN_SLOT_GREY is a measurement, not a preference. It sits between the worst genuine
    slot in the corpus and the best occluded one, and this pins the gap so a tweak that
    closes it fails here rather than in someone's item counts."""
    worst_genuine = 1.0
    for path in COMPLETE_CAPTURES:
        img = _load(path)
        g = find_grid(img)
        grey = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        band = cv2.inRange(grey, 216, 236)
        p = round(g.pitch)
        for r in range(ROWS):
            for c in range(COLS):
                x, y = g.cell(r, c)[:2]
                worst_genuine = min(worst_genuine, band[y : y + p, x : x + p].mean() / 255.0)

    base = _load(f"{REF}/inventory sample.png")
    g = find_grid(base)
    best_occluded = 0.0
    for occluder in OCCLUDERS:
        img = _occlude(base, g, occluder, rows=4, cols=8)
        gg = find_grid(img)
        band = cv2.inRange(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY), 216, 236)
        p = round(gg.pitch)
        x0, y0 = gg.cell(2, 2)[:2]
        for r in range(2, 6):
            for c in range(2, 10):
                x, y = gg.cell(r, c)[:2]
                best_occluded = max(best_occluded, band[y : y + p, x : x + p].mean() / 255.0)

    assert best_occluded < MIN_SLOT_GREY < worst_genuine, (
        f"threshold {MIN_SLOT_GREY} no longer separates "
        f"occluded (max {best_occluded:.3f}) from genuine (min {worst_genuine:.3f})"
    )
