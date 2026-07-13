"""Screenshot parsing service.

Runs as a second container in the same ECS task as the Ktor backend, which calls it over
loopback, one deployable, two processes. It replaced a Claude-vision call: the parse is a
deterministic OpenCV pipeline (see app/cv/), so it costs no tokens, makes no network call, and
returns the same answer every time. Nothing about the vision LLM survives; the backend now
speaks to this service directly.

The HUD ("Lv.287 acornacorn") is read too. Located by matching the fixed-pixel "Lv." prefix,
then OCR'd with Tesseract. It is null when no HUD is in frame, which the backend treats as
needing review.

Two things this service will NOT do, both learned the hard way:

  * It will not report a count it cannot stand behind. An item whose stack count is unreadable
    is dropped rather than reported with a guessed number, a wrong count is worse than a
    missing one, and it is the failure this whole project exists to prevent.
  * It will not refuse a capture it can actually read. A rescaled screenshot (remote play,
    display scaling) used to be rejected on the strength of an accuracy figure that had been
    measured through our OWN lossy resampling step. Read at its native scale, those captures
    parse fine. See app/cv/classify.scale_templates.
"""

import logging
import time
from contextlib import contextmanager
from typing import Literal

import cv2
import numpy as np
from fastapi import FastAPI, HTTPException, Request, Response
from pydantic import BaseModel

from app.cv.classify import classify
from app.cv.grid import find_grid
from app.cv.hud import find_hud
from app.cv.match import load_templates
from app.cv.ocr import load_font, read_count
from app.cv.pipeline import MIN_PITCH, looks_like_inventory_window, normalize

log = logging.getLogger("vision")

MAX_UPLOAD_BYTES = 20 * 1024 * 1024

# Loaded once at import: the catalog is fixed and the templates are small.
TOKENS = load_templates()
FONT = load_font()

app = FastAPI(title="maplestorage-vision")


class DetectedToken(BaseModel):
    tokenName: str
    quantity: int
    # Diagnostic only; the backend ignores it. Every count we return is one we
    # stand behind. See the 422 below for the ones we don't.
    iconScore: float


class CharacterHud(BaseModel):
    name: str
    level: int


class ScreenshotParseResult(BaseModel):
    screenshotType: Literal["INVENTORY", "UNRECOGNIZED"]
    # Null when no HUD is in frame, a tightly-cropped inventory upload has
    # none, and the backend already treats that as NEEDS_REVIEW.
    characterHud: CharacterHud | None = None
    tokenCounts: list[DetectedToken] | None = None


def _downscaled_message() -> str:
    """The one rescale we genuinely cannot undo.

    An upscale interpolates: it adds no information, but it destroys none either, and the
    parser now reads the capture at whatever scale it arrives in rather than squeezing it
    back to native first. A DOWNSCALE actually discards pixels, and the 11px count font is
    the first thing to go. There is nothing to recover and no kernel that invents it back.

    So this is the only rescale left that we refuse, and unlike the old blanket refusal it
    asks the user for something they can always do: send the file they already have, whole.
    """
    return (
        "This screenshot was shrunk before upload, and the stack-count digits did not "
        "survive it. Upload the original file at its full resolution."
    )


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "tokens": len(TOKENS), "digits": len(FONT)}


class Stages:
    """Per-stage timings for one parse, emitted as a Server-Timing header.

    The parse is the slowest thing in an upload by two orders of magnitude, the
    backend answers in ~1ms and this takes hundreds. So when an upload feels slow,
    the only useful question is WHICH stage, and that was previously unanswerable
    without attaching a profiler.
    """

    def __init__(self) -> None:
        self.spans: list[tuple[str, float]] = []

    @contextmanager
    def __call__(self, name: str):
        start = time.perf_counter()
        try:
            yield
        finally:
            self.spans.append((name, (time.perf_counter() - start) * 1000))

    def header(self) -> str:
        total = sum(ms for _, ms in self.spans)
        parts = [f"{n};dur={ms:.1f}" for n, ms in self.spans]
        parts.append(f"total;dur={total:.1f}")
        return ", ".join(parts)

    def log(self) -> str:
        return " ".join(f"{n}={ms:.0f}ms" for n, ms in self.spans)


@app.post("/parse", response_model=ScreenshotParseResult)
async def parse(request: Request, response: Response) -> ScreenshotParseResult:
    stage = Stages()
    body = await request.body()
    if not body:
        raise HTTPException(400, "empty body")
    if len(body) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"image exceeds {MAX_UPLOAD_BYTES} bytes")

    with stage("decode"):
        img = cv2.imdecode(np.frombuffer(body, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(400, "not a decodable image")

    try:
        with stage("grid"):
            g = find_grid(img)
    except ValueError as e:
        # No slot lattice, by either segmentation or correlation. Two very different reasons,
        # and telling the user the wrong one sends them to fix the wrong thing:
        #
        #   * It really is not an inventory (a login screen, the character select).
        #   * It IS an inventory we still could not read. This is now rare, the smeared
        #     boundaries of a rescaled capture are handled by find_grid's correlation path,
        #     so if we land here the cause is something we have not seen, and the honest thing
        #     is to say so rather than to guess at a cause and send the user off to fix it.
        log.info("no grid: %s", e)
        if looks_like_inventory_window(img):
            raise HTTPException(
                422,
                "This looks like an inventory window, but the slot grid could not be located "
                "in it. Upload the original screenshot file, unedited and uncropped.",
            ) from e
        return ScreenshotParseResult(screenshotType="UNRECOGNIZED")

    # A capture with LESS detail than the client drew is still refused: the 11px count font
    # is the first casualty of a downscale and no amount of cleverness invents it back.
    #
    # An UPSCALED capture is a different matter, and used to be refused here too. That was
    # wrong, and the reason it was wrong is worth keeping: the reliability figures that
    # justified the refusal were all measured through a pipeline that resampled the frame
    # down to native before reading it, so what they actually measured was the damage the
    # parser was doing to itself, not the damage in the capture. Read at its own scale, a
    # real Parsec frame at 1.33x gives up all five of its items and all five stack counts.
    if g.pitch < MIN_PITCH:
        raise HTTPException(422, _downscaled_message())

    # Only an integer upscale is undone, because only that one reverses without loss.
    # Everything else is read at the scale it arrived in: the templates and digit glyphs are
    # scaled up to meet the frame rather than the frame being squeezed down to meet them.
    with stage("normalize"):
        img, g = normalize(img, g)

    with stage("hud"):
        hud = find_hud(img, scale=g.scale)

    # Two-stage: shortlist every slot with a cheap descriptor, verify the top candidates
    # exactly. The verify cost is O(TOP_K) rather than O(catalog), so this holds up as the
    # catalog grows. What does NOT come for free is the shortlist's recall, which is pinned by
    # a test rather than a hope. See app/cv/classify.py.
    with stage("classify"):
        hits = classify(img, g, TOKENS)

    # One item can occupy SEVERAL slots, so results are summed per item rather than emitted
    # per slot.
    #
    # This is not a hypothetical. Every symbol coupon exists in a tradeable and an untradeable
    # version. They are different items to the client, they sit in different slots, and they are
    # drawn with THE SAME ICON. There is no pixel anywhere in the slot that tells them apart.
    # (The cyan bar along the bottom is not it: that marks a slot the player has locked against
    # the in-game auto-sort, and is a property of the slot, not of what is in it.)
    #
    # So summing is not a convenience, it is the only honest answer available. We cannot say how
    # many of a player's 1427 Tallahart coupons are tradeable, and any split we reported would be
    # invented. The total is true regardless of which slot is which.
    #
    # Emitting one result per slot and letting the backend upsert them would have quietly kept
    # whichever arrived last and discarded the other: 630 reported against 1427 held. A silent
    # undercount (precisely the failure the rest of this pipeline exists to prevent) and it
    # would have looked entirely plausible on screen.
    totals: dict[str, list] = {}
    with stage("counts"):
        for hit in hits:
            digits, conf = read_count(img, g, hit.row, hit.col, FONT)
            if not digits:
                # Icon found but the count is unreadable. Reporting the item with
                # a fabricated quantity would be worse than reporting nothing.
                log.info("unreadable count for %s at r%dc%d", hit.name, hit.row, hit.col)
                continue
            slot = totals.setdefault(hit.name, [0, 0.0])
            slot[0] += int(digits)
            slot[1] = max(slot[1], hit.score)

    counts = [
        DetectedToken(tokenName=name, quantity=qty, iconScore=round(score, 3))
        for name, (qty, score) in totals.items()
    ]

    # The backend forwards this straight through to the browser, so a slow upload can
    # be attributed to a stage from the Network panel, without a profiler or a log dive.
    response.headers["Server-Timing"] = stage.header()
    log.info("parsed %dx%d: %s", img.shape[1], img.shape[0], stage.log())

    return ScreenshotParseResult(
        screenshotType="INVENTORY",
        characterHud=CharacterHud(name=hud.name, level=hud.level) if hud else None,
        tokenCounts=counts,
    )
