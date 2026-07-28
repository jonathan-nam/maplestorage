"""Offering a user their own untracked items, and refusing to author from bad pixels.

Two separate guarantees, and the second is the one with teeth. /discover is the front of
the "track this item" flow, so everything it offers is a candidate template, and a template
cut from resampled pixels is permanent damage to every future parse (see
admit.require_native_scale).
"""

import base64

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient
from fixtures import INVENTORY

from app.cv.admit import clashes
from app.cv.match import load_templates
from app.main import app

client = TestClient(app)

NATIVE = f"{INVENTORY}/untradeables sample.png"


def _post(img) -> object:
    return client.post("/discover", content=cv2.imencode(".png", img)[1].tobytes())


def test_discover_offers_the_untracked_part_of_the_inventory():
    """An ordinary inventory is MOSTLY untracked, and that is not an error.

    Pinned as a range rather than a number because it is a property of the fixture, not of
    the code: the point is that this is dozens of slots, so no caller can treat a non-empty
    result as an anomaly worth warning about.
    """
    r = _post(cv2.imread(NATIVE))
    assert r.status_code == 200, r.json()
    body = r.json()

    assert body["knownCount"] > 0
    assert 40 < len(body["slots"]) < 128


def test_offered_crops_are_real_decodable_slots():
    body = _post(cv2.imread(NATIVE)).json()

    for slot in body["slots"]:
        raw = np.frombuffer(base64.b64decode(slot["imagePng"]), np.uint8)
        cell = cv2.imdecode(raw, cv2.IMREAD_COLOR)
        assert cell is not None, f"r{slot['row']}c{slot['col']} did not decode"
        assert cell.shape[0] >= 40 and cell.shape[1] >= 40, cell.shape


def test_nothing_already_tracked_is_offered():
    """A slot the catalog claims must never appear in the picker: offering it invites a user
    to add a second template for an item that already has one, which is the confusable pair
    admit.clashes exists to refuse."""
    body = _post(cv2.imread(NATIVE)).json()
    offered = {(s["row"], s["col"]) for s in body["slots"]}

    parsed = client.post("/parse", content=cv2.imencode(".png", cv2.imread(NATIVE))[1].tobytes())
    assert parsed.status_code == 200
    assert len(parsed.json()["tokenCounts"]) > 0

    # knownCount counts slots, tokenCounts counts items, and one item can hold several slots.
    assert body["knownCount"] >= len(parsed.json()["tokenCounts"])
    assert len(offered) + body["knownCount"] <= 128


@pytest.mark.parametrize("factor", [1.25, 1.326])
def test_a_rescaled_capture_cannot_author_an_item(factor):
    """/parse READS these fine and must keep doing so. /discover must refuse them anyway.

    The two endpoints are asked different questions. Parsing scales the catalog up to meet
    the frame, which costs nothing. Authoring would bake the frame's resampling into a
    template forever, and cut from a 1.326x capture the Arcane and Sacred Symbols matched
    each other better than themselves.
    """
    img = cv2.imread(NATIVE)
    scaled = cv2.resize(img, None, fx=factor, fy=factor, interpolation=cv2.INTER_CUBIC)

    parsed = client.post("/parse", content=cv2.imencode(".png", scaled)[1].tobytes())
    assert parsed.status_code == 200, parsed.json()

    r = _post(scaled)
    assert r.status_code == 422
    assert "rescaled" in r.json()["detail"]


def test_an_integer_upscale_is_offered_not_refused():
    """Pixel replication reverses exactly, so a 2x capture is native pixels after normalize.
    Refusing it would turn UI Optimization and 200% DPI into "you cannot add items"."""
    img = cv2.imread(NATIVE)
    doubled = cv2.resize(img, None, fx=2, fy=2, interpolation=cv2.INTER_NEAREST)

    r = _post(doubled)
    assert r.status_code == 200, r.json()
    assert len(r.json()["slots"]) > 40


def test_an_item_already_in_the_catalog_cannot_be_added_again():
    """The admission gate's whole job, stated as the case it must catch: a candidate that IS
    a catalog item scores 1.000 against itself and must come back as a clash."""
    templates = load_templates()
    key = "kalos-token"

    found = clashes(templates[key], templates)
    assert [c.key for c in found] == [key]
    assert found[0].shape > 0.99
