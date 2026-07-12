"""End-to-end tests against the real screenshots.

This is the regression suite the vision service exists to preserve: the same corpus
that validated the spike (16/16 token counts across three screenshots) now
guards the service. If a change to the CV breaks a count, it breaks here.
"""

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

REF = "../reference-images"

# Hand-verified by reading the digits off each screenshot.
TRUTH = {
    f"{REF}/untradeables sample.png": {
        "blissful-fantasy-shard": 6,
        "distorted-ambition": 10,
        "echo-ancient-resolve": 6,
        "ferocious-beast-ring": 9,
        "kalos-token": 21,
    },
    f"{REF}/inventory sample.png": {
        "distorted-ambition": 9,
        "echo-ancient-resolve": 14,
        "ferocious-beast-ring": 4,
        "kalos-token": 19,
        "trace-eternal-loyalty": 16,
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
    assert r.json() == {"status": "ok", "tokens": 6, "digits": 10}


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
    assert len(r.json()["tokenCounts"]) == 5


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
