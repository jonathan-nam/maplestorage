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
from app.cv.pipeline import counts_trustworthy, looks_like_inventory_window, normalize

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
    """Why we cannot read this capture, in terms of what the user can change.

    Every cause here is a RESAMPLE. MapleStory draws its UI at a fixed pixel size, so the
    game's own resolution never matters -- what matters is whether anything stretched the
    picture between the client drawing it and us seeing it. A fractional stretch smears the
    one-pixel slot ridges into gradients and turns the 11px count font into mush, and no
    kernel brings either back.

    Remote play is named explicitly because it is invisible as a cause and increasingly
    common. A Parsec frame arrived scaled 1.326x, and the previous message told the user to
    check their *display scaling* -- which is not what was wrong and would not have fixed it.

    Measured, so the advice is not a guess: a Parsec-style H.264 stream at NATIVE resolution
    parses 12/12 items perfectly at crf 18 and crf 23. Video compression does us no harm at
    all -- MapleStory's UI is flat colour with hard edges, which H.264 handles well. It is
    only the rescale that destroys it. So remote play is fine; remote play that resizes the
    stream is not.
    """
    if pitch < NATIVE_PITCH:
        return (
            "This screenshot was shrunk before upload, and the stack-count digits are no "
            "longer readable. Upload the original file at its full resolution."
        )
    return (
        "This screenshot was stretched from its original size, which blurs the stack-count "
        "digits past reading. Something resized the picture between the game drawing it and "
        "the file being saved. The usual causes: Windows display scaling above 100%; a "
        "remote-play session (Parsec, Moonlight, Steam Remote Play) whose window does not "
        "match the host's resolution, so the stream is being resized; or the image being "
        "resized after capture. Fix whichever applies -- for remote play, set the client to "
        "the host's resolution -- and take the screenshot again. MapleStory's own UI "
        "Optimization is fine: it scales by exactly 2x, which we handle."
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
        # No slot lattice. Two very different reasons, and telling the user the wrong one
        # sends them to fix the wrong thing:
        #
        #   * It really is not an inventory (a login screen, the character select).
        #   * It IS an inventory, but the capture was scaled -- Windows display scaling
        #     upscales and smears it, so the slot boundaries stop resolving. The client drew
        #     it perfectly; the screenshot ruined it. Saying "not an inventory" there is a lie
        #     that costs the user an afternoon.
        log.info("no grid: %s", e)
        if looks_like_inventory_window(img):
            raise HTTPException(422, _rescaled_message(NATIVE_PITCH * 1.5)) from e
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
