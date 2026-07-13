"""End-to-end tests against the real screenshots.

This is the regression suite the vision service exists to preserve: the same corpus
that validated the spike (16/16 token counts across three screenshots) now
guards the service. If a change to the CV breaks a count, it breaks here.
"""

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.cv.grid import NATIVE_PITCH, find_grid
from app.cv.hud import HUD_RE, find_hud
from app.cv.match import load_templates
from app.main import app

client = TestClient(app)

REF = "../reference-images"

# Hand-verified by reading the digits off each screenshot.
#
# The elixirs and potions were added on 2026-07-12. Their counts were read the same way --
# off magnified crops of the slots the classifier claims, checking that the icon IS the item
# and the digits ARE the number. Pasting the parser's own output in here would make the test
# assert that the parser agrees with itself.
TRUTH = {
    f"{REF}/untradeables sample.png": {
        "blissful-fantasy-shard": 6,
        "distorted-ambition": 10,
        "echo-ancient-resolve": 6,
        "ferocious-beast-ring": 9,
        "kalos-token": 21,
        "collector-elixir": 1,
        "honorable-elixir": 1,
        "sayram-elixir": 1,
        "extreme-blue-potion": 8,
        "extreme-green-potion": 8,
        # Missed for a while by the TOP_K=3 descriptor shortlist, which never handed this
        # template to the verifier. It scores 1.000 -- a pixel-perfect match, confirmed by
        # eye against the template. The shortlist was hiding a real item, and the truth table
        # inherited the blind spot because it was built from the parser's own output.
        "aurelia-elixir": 1,
    },
    f"{REF}/inventory sample.png": {
        "distorted-ambition": 9,
        "echo-ancient-resolve": 14,
        "ferocious-beast-ring": 4,
        "kalos-token": 19,
        "trace-eternal-loyalty": 16,
        "sayram-elixir": 18,
    },
    # The only screenshot carrying all SIX tokens, and a cropped panel rather than
    # a full desktop -- so it also proves the grid detector does not depend on the
    # surrounding game window being in frame.
    f"{REF}/inventory804x550.png": {
        "blissful-fantasy-shard": 48,
        "distorted-ambition": 17,
        "echo-ancient-resolve": 51,
        "ferocious-beast-ring": 50,
        "kalos-token": 21,
        "trace-eternal-loyalty": 20,
        "aurelia-elixir": 3,
        "collector-elixir": 3,
        "honorable-elixir": 3,
        "sayram-elixir": 3,
        "extreme-green-potion": 9,
        "extreme-red-potion": 9,
    },
    # The screenshot the elixir and potion templates were cut from.
    f"{REF}/potions.png": {
        "blissful-fantasy-shard": 18,
        "distorted-ambition": 10,
        "echo-ancient-resolve": 6,
        "ferocious-beast-ring": 9,
        "kalos-token": 21,
        "aurelia-elixir": 1,
        "collector-elixir": 1,
        "honorable-elixir": 1,
        "sayram-elixir": 1,
        "extreme-blue-potion": 9,
        "extreme-green-potion": 9,
        "extreme-red-potion": 1,
    },
}


def _parse(path: str, quality: int | None = None):
    img = cv2.imread(path)
    assert img is not None, path
    if quality is None:
        blob = cv2.imencode(".png", img)[1].tobytes()
    else:
        blob = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, quality])[1].tobytes()
    r = client.post("/parse", content=blob)
    return r


def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["digits"] == 10
    # Not a hardcoded 6. The catalog grows; what must hold is that health reports what is
    # actually loaded.
    assert body["tokens"] == len(load_templates())


@pytest.mark.parametrize("path,truth", TRUTH.items())
def test_counts_match_truth(path, truth):
    r = _parse(path)
    assert r.status_code == 200
    body = r.json()
    assert body["screenshotType"] == "INVENTORY"
    got = {t["tokenName"]: t["quantity"] for t in body["tokenCounts"]}
    assert got == truth


@pytest.mark.parametrize("path,truth", TRUTH.items())
def test_counts_survive_jpeg(path, truth):
    """The frontend sends JPEG q92; the safe band is 75-95."""
    r = _parse(path, quality=92)
    assert r.status_code == 200
    got = {t["tokenName"]: t["quantity"] for t in r.json()["tokenCounts"]}
    assert got == truth


def test_downscaled_upload_is_rejected_loudly():
    """A shrunk screenshot must 422, not return silently-wrong counts."""
    img = cv2.imread(f"{REF}/untradeables sample.png")
    small = cv2.resize(img, None, fx=0.9, fy=0.9, interpolation=cv2.INTER_AREA)
    r = client.post("/parse", content=cv2.imencode(".png", small)[1].tobytes())
    assert r.status_code == 422
    assert "full resolution" in r.json()["detail"]


def test_fractionally_rescaled_capture_is_rejected_not_flagged():
    """A 1.25x capture (fractional display scaling) reads only ~70-77% of counts
    correctly. We refuse it and say how to fix the capture, rather than writing
    numbers we do not stand behind -- the review UI cannot correct a count."""
    img = cv2.imread(f"{REF}/untradeables sample.png")
    scaled = cv2.resize(img, None, fx=1.25, fy=1.25, interpolation=cv2.INTER_CUBIC)
    r = client.post("/parse", content=cv2.imencode(".png", scaled)[1].tobytes())
    assert r.status_code == 422
    detail = r.json()["detail"]
    assert "display scaling" in detail or "UI Optimization" in detail


def test_ui_optimization_2x_is_accepted():
    """MapleStory's UI Optimization is exact 2x pixel doubling, which downsamples
    back losslessly. It must NOT be caught by the rescale check."""
    img = cv2.imread(f"{REF}/untradeables sample.png")
    doubled = cv2.resize(img, None, fx=2, fy=2, interpolation=cv2.INTER_NEAREST)
    r = client.post("/parse", content=cv2.imencode(".png", doubled)[1].tobytes())
    assert r.status_code == 200
    got = {t["tokenName"]: t["quantity"] for t in r.json()["tokenCounts"]}
    assert got == TRUTH[f"{REF}/untradeables sample.png"]


def test_a_real_downscaled_upload_is_rejected():
    """inventory377x275.png is a real shrunk capture (from the M3 vision-LLM era,
    when downscaling was the plan). It is now exactly the input we must refuse."""
    img = cv2.imread(f"{REF}/inventory377x275.png")
    assert img is not None
    r = client.post("/parse", content=cv2.imencode(".png", img)[1].tobytes())
    # No inventory lattice survives at that size, so it cannot even be recognised
    # as an inventory -- which is the honest answer, not a fabricated count.
    assert r.status_code in (200, 422)
    if r.status_code == 200:
        assert r.json()["screenshotType"] == "UNRECOGNIZED"


def test_non_inventory_image_is_unrecognized():
    """Not an error -- the same answer the vision model gave."""
    noise = np.random.randint(0, 255, (600, 800, 3), dtype=np.uint8)
    r = client.post("/parse", content=cv2.imencode(".png", noise)[1].tobytes())
    assert r.status_code == 200
    assert r.json()["screenshotType"] == "UNRECOGNIZED"
    assert r.json()["tokenCounts"] is None


def test_garbage_body_is_a_400():
    r = client.post("/parse", content=b"this is not an image")
    assert r.status_code == 400


# --- HUD -------------------------------------------------------------------
# Only one of our screenshots has a HUD in frame, so this is a thin corpus.
# See README: it is enough to prove the mechanism, not the alphabet.


def test_hud_is_read_when_in_frame():
    r = _parse(f"{REF}/untradeables sample.png")
    assert r.json()["characterHud"] == {"name": "acornacorn", "level": 287}


def test_hud_survives_the_jpeg_the_frontend_sends():
    r = _parse(f"{REF}/untradeables sample.png", quality=92)
    assert r.json()["characterHud"] == {"name": "acornacorn", "level": 287}


def test_hud_is_null_when_not_in_frame():
    """A cropped inventory upload has no HUD. Null, not an error -- the backend
    already routes this to NEEDS_REVIEW."""
    r = _parse(f"{REF}/inventory sample.png")
    assert r.json()["characterHud"] is None
    # ...and the token counts are still read fine without it.
    assert len(r.json()["tokenCounts"]) == len(TRUTH[f"{REF}/inventory sample.png"])


# --- catalog scaling -------------------------------------------------------


def test_classify_is_flat_in_catalog_size():
    """The whole point of the two-stage classifier: adding items must not add
    time. Sliding one matchTemplate per item was O(N) -- ~38s at 500 items."""
    import time

    import cv2

    from app.cv.classify import classify
    from app.cv.grid import find_grid
    from app.cv.match import load_templates

    img = cv2.imread(f"{REF}/inventory sample.png")
    g = find_grid(img)
    base = load_templates()

    def timed(n):
        cat = dict(base)
        vals = list(base.values())
        for i in range(n - len(base)):
            cat[f"filler{i}"] = vals[i % len(vals)]
        t = time.perf_counter()
        classify(img, g, cat)
        return time.perf_counter() - t

    small, large = timed(6), timed(500)
    # An O(N) matcher would be ~80x slower here. Allow generous headroom for a
    # loaded CI box while still failing loudly if the scaling regresses.
    assert large < small * 3, f"catalog scaling regressed: {small:.2f}s -> {large:.2f}s"


# The HUD name is bounded by MapleStory's IGN charset, not by the end of the crop.
#
# Regression: LINE_RIGHT is a fixed 175px window, sized for the longest possible IGN.
# On a SHORT name it overruns into the HUD icons beside it, and Tesseract reads those
# as trailing glyphs. A real upload produced "acornacorn?. ©", which the backend then
# saved as a character by that name -- parse correct, identity wrong.
#
# Widening the crop would still overrun a 4-character name; narrowing it would
# truncate a 12-character one. The charset is the only boundary that holds for both.
@pytest.mark.parametrize(
    "text,level,name",
    [
        ("Lv.287 acornacorn", 287, "acornacorn"),
        ("Lv.287 acornacorn?. ©", 287, "acornacorn"),  # the bug, verbatim
        ("Lv.287 acornacorn ©@ x", 287, "acornacorn"),
        ("tv.287 acornacorn", 287, "acornacorn"),  # garbled prefix, already confirmed by the match
        ("Lv.200 Ab12", 200, "Ab12"),  # digits are legal in an IGN
        ("Lv.5 Bubbling", 5, "Bubbling"),
    ],
)
def test_hud_name_stops_at_the_ign_charset(text, level, name):
    m = HUD_RE.match(text)
    assert m is not None, text
    assert int(m.group(1)) == level
    assert m.group(2) == name


# The HUD must survive being read at a range of scales, not just at native.
#
# Regression: the HUD line is ~24px tall at native scale -- far below what Tesseract
# expects -- and at that size "rn" has too few pixels to stay distinct from "m". A real
# upload read `acornacorm`, and the app created a character by that name, with no level,
# job or sprite, because Nexon has never heard of them.
#
# Tested against find_hud directly rather than through /parse, because /parse rightly
# rejects fractional-scale captures outright (the stack counts are unreadable there, see
# counts_trustworthy). The HUD reader still has to be robust at those scales: it is
# reached on the native and integer-scaled captures we DO accept, and the failure mode
# is a function of how few pixels the text has, not of which caller asked.
@pytest.mark.parametrize("capture_scale", [1.0, 1.1, 1.25, 1.5, 2.0])
def test_hud_reads_at_every_capture_scale(capture_scale):
    img = cv2.imread(f"{REF}/untradeables sample.png")
    if capture_scale != 1.0:
        img = cv2.resize(
            img, None, fx=capture_scale, fy=capture_scale, interpolation=cv2.INTER_CUBIC
        )

    g = find_grid(img)
    hud = find_hud(img, scale=g.pitch / NATIVE_PITCH)

    assert hud is not None, f"no HUD found at {capture_scale}x"
    assert hud.name == "acornacorn", f"misread at {capture_scale}x: {hud.name!r}"
    assert hud.level == 287
