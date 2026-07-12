"""Screenshot parsing service.

Runs as a second container in the same ECS task as the Ktor backend, which calls
it over loopback -- one deployable, two processes. It replaces the Claude-vision
call for token counts:
the parse is a deterministic OpenCV pipeline (see app/cv/), so it costs no
tokens, makes no network call, and returns the same answer every time.

The response mirrors Kotlin's `ScreenshotParseResult` so the backend's existing
`ClaudeVisionService` seam keeps working -- only the implementation behind it
changes.

The HUD ("Lv.287 acornacorn") is read too -- located by matching the fixed-pixel
"Lv." prefix, then OCR'd with Tesseract. It is null when no HUD is in frame,
which the backend already treats as NEEDS_REVIEW.
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
from app.cv.grid import NATIVE_PITCH, find_grid
from app.cv.hud import find_hud
from app.cv.match import load_templates
from app.cv.ocr import load_font, read_count
from app.cv.pipeline import counts_trustworthy, normalize

log = logging.getLogger("vision")

MAX_UPLOAD_BYTES = 20 * 1024 * 1024

# Loaded once at import: the catalog is fixed and the templates are ~50KB.
TOKENS = load_templates()
FONT = load_font()

app = FastAPI(title="maplestorage-vision")


class DetectedToken(BaseModel):
    tokenName: str
    quantity: int
    # Diagnostic only; the backend ignores it. Every count we return is one we
    # stand behind -- see the 422 below for the ones we don't.
    iconScore: float


class CharacterHud(BaseModel):
    name: str
    level: int


class ScreenshotParseResult(BaseModel):
    screenshotType: Literal["INVENTORY", "UNRECOGNIZED"]
    # Null when no HUD is in frame -- a tightly-cropped inventory upload has
    # none, and the backend already treats that as NEEDS_REVIEW.
    characterHud: CharacterHud | None = None
    tokenCounts: list[DetectedToken] | None = None


def _rescaled_message(pitch: float) -> str:
    if pitch < NATIVE_PITCH:
        return (
            "This screenshot was shrunk before upload, and the stack-count "
            "digits are no longer readable. Upload the original file at its "
            "full resolution."
        )
    return (
        "This screenshot was captured at a scaled resolution, so the "
        "stack-count digits are too blurred to read reliably. Set your display "
        "scaling to 100%, or turn on MapleStory's UI Optimization (which scales "
        "cleanly), then take the screenshot again."
    )


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "tokens": len(TOKENS), "digits": len(FONT)}


class Stages:
    """Per-stage timings for one parse, emitted as a Server-Timing header.

    The parse is the slowest thing in an upload by two orders of magnitude -- the
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
        # No inventory lattice: this isn't an inventory screenshot (or it was
        # downscaled past the point of being one). Either way it is the same
        # answer the vision model gave -- UNRECOGNIZED, not an error.
        log.info("no grid: %s", e)
        return ScreenshotParseResult(screenshotType="UNRECOGNIZED")

    # Any capture that is not at the client's native scale gets refused, and the
    # message tells the user how to fix it.
    #
    # We used to return these counts with a "needsReview" flag instead. That was
    # a half-measure: the review UI can only re-attribute a screenshot to a
    # different character, it has no way to correct a *count*, so the dubious
    # number was written to the database regardless. And the reliability figure
    # for a fractionally-rescaled capture (~70-77%) comes from a synthetic model
    # -- we have never seen a real one -- so we do not actually know how wrong it
    # gets.
    #
    # For an app whose whole value is accurate counts, "you have 8" when you have
    # 9 is worse than "we could not read this". The fix on the user's side is a
    # one-time display setting, after which every upload works.
    if not counts_trustworthy(g.pitch):
        raise HTTPException(422, _rescaled_message(g.pitch))

    with stage("normalize"):
        img, g = normalize(img, g)

    # normalize() resamples the whole frame to the client's native pitch, so the
    # HUD is at native scale here too and needs no scale of its own.
    with stage("hud"):
        hud = find_hud(img)

    counts = []
    # Two-stage: shortlist every slot with a cheap descriptor, verify the top
    # candidates exactly. Flat in catalog size, so this still holds up when the
    # catalog grows past the 6 tokens (see app/cv/classify.py).
    with stage("classify"):
        hits = classify(img, g, TOKENS)

    with stage("counts"):
        for hit in hits:
            digits, conf = read_count(img, g, hit.row, hit.col, FONT)
            if not digits:
                # Icon found but the count is unreadable -- reporting the item with
                # a fabricated quantity would be worse than reporting nothing.
                log.info("unreadable count for %s at r%dc%d", hit.name, hit.row, hit.col)
                continue
            counts.append(
                DetectedToken(
                    tokenName=hit.name,
                    quantity=int(digits),
                    iconScore=round(hit.score, 3),
                )
            )

    # The backend forwards this straight through to the browser, so a slow upload can
    # be attributed to a stage from the Network panel, without a profiler or a log dive.
    response.headers["Server-Timing"] = stage.header()
    log.info("parsed %dx%d: %s", img.shape[1], img.shape[0], stage.log())

    return ScreenshotParseResult(
        screenshotType="INVENTORY",
        characterHud=CharacterHud(name=hud.name, level=hud.level) if hud else None,
        tokenCounts=counts,
    )
