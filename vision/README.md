# vision. Screenshot parsing service

Parses MapleStory inventory screenshots into token counts with classical CV.

Runs as its own container beside the backend, which calls it at `http://vision:8000`.
It is behind the `parser` compose profile and is **not deployed to production**, so it
exists for local work and its own tests. See docker-compose.prod.yml for why.

It replaces the Claude-vision call for token counts. The parse is deterministic
OpenCV (`app/cv/`, ported from `spikes/inventory-cv`): no tokens, no network
call, ~0.6s per screenshot, and the same answer every time.

## API

| Route | Behaviour |
| --- | --- |
| `GET /health` | `{"status":"ok","tokens":26,"digits":10}`. `tokens` is however many templates are on disk. |
| `POST /parse` | Raw image bytes in. Returns `ScreenshotParseResult` (same shape as the Kotlin DTO): `screenshotType`, `characterHud`, `tokenCounts`. |

`POST /parse` outcomes, and why each is what it is:

| Result | When |
| --- | --- |
| `200` + `screenshotType: "INVENTORY"` | Grid found; `tokenCounts` holds every token detected. |
| `200` + `screenshotType: "UNRECOGNIZED"` | No inventory lattice. Not an error, it simply is not an inventory. |
| `422` | The capture was SHRUNK before upload. Downscaling throws pixels away and the 11px count font is the first casualty; nothing recovers it. An upscaled or rescaled capture is *read*, not refused. |
| `400` | Body is empty or not a decodable image. |

**Every count we return is one we stand behind.** An item whose stack count cannot be read is
dropped rather than reported with a guessed number, a wrong count is worse than a missing one.

**But we no longer refuse a capture we can actually read.** Rescaled screenshots (remote play,
display scaling) used to be rejected with a 422, on the strength of a 70–77% accuracy figure. That
figure was real and it measured the wrong thing: the parser resampled the frame back down to native
*before* reading it, so what it recorded was the damage the parser was doing to itself. A real
Parsec capture at 1.326x, refused outright, had every item and every count sitting legible in the
file. The catalog is now scaled *up* to meet the frame instead, and the frame is left alone.

Only a **downscale** is still refused: that one genuinely discards pixels.

## Character attribution (solved)

The HUD is read: `characterHud` returns `{name, level}` when a HUD is in frame,
`null` when it is not (a tightly-cropped upload has none, which the backend
already routes to NEEDS_REVIEW). No vision call, no per-screenshot cost.

It works by the opposite method to the stack counts, and that contrast is the
point:

| | Stack counts | Character HUD |
| --- | --- | --- |
| Text | 11px bitmap font, over icon art | ~20px anti-aliased proportional, on a dark plate |
| Tesseract | **2/12**. Unusable | **exact** on the raw crop |
| What works | Matching the client's own 10 glyphs | Tesseract, with no preprocessing at all |

Every binarisation we tried made the HUD *worse* (`acornacom`, `Lv.28/7`), so
`hud.py` feeds Tesseract the raw pixels. Glyph templates were never an option
here anyway: an IGN is arbitrary text, so the alphabet is ~62 glyphs, and we
have one HUD sample containing five distinct letters.

Locating the HUD is the part classical CV does well. It is anchored to the *game
window*, not the screenshot, so its position moves, but the client draws `Lv.`
at a fixed pixel size, so we match that prefix (score 1.000, and 0.998 through
JPEG q92) and read the line beside it.

**Caveat worth keeping in view:** exactly one of our three screenshots has a HUD,
so the corpus proves the *mechanism*, not the *alphabet*. Tesseract read
`acornacorn` exactly, but no IGN with unusual glyphs, mixed case, or digits has
been tested. The first misread IGN will show up as a name that does not match the
roster, which lands in the existing one-click confirm flow rather than corrupting
data, so the failure mode is safe. Collect a few more HUDs before trusting it
blindly.

## Catalog scaling (solved)

Icon matching used to slide one `matchTemplate` per catalog item across the
grid. **O(N)**, which is fine at this catalog size and unusable for an item catalog.
`classify.py` replaces it with a two-stage scheme whose cost is flat in catalog
size:

| Catalog | Old (per-template) | Now (two-stage) |
| --- | --- | --- |
| 6 | ~0.4s | 231 ms |
| 50 | ~3.8s | 239 ms |
| 500 | ~37.5s | 273 ms |

1. **Shortlist**, every slot becomes one 16×16 descriptor; a single matmul
   scores all 128 slots against all N items.
2. **Verify**, only the top-3 candidates per slot get the exact masked
   correlation (1.000 on a true match, ~0.3 on a false one). This stage is
   O(1) in N.

The split is load-bearing: each stage is bad at the other's job. The descriptor
*ranks* well (recall@1 was 5/5 on both held-out screenshots) but its absolute
score cannot separate "a catalog item" from "some other item", an unrelated
icon's nearest neighbour still scores ~0.7. **Verification discriminates; the
descriptor only decides what is worth verifying.** Still 16/16 counts, zero
false positives across all 128 slots.

Three failed attempts are recorded in `classify.py` so nobody repeats them:
exact pixel-hashing (the slot backing has a per-row gradient, so the same icon
hashes differently. 302 distinct hashes across 308 slots, *zero* collisions);
a descriptor without background subtraction (the grey backing dominates, margin
−0.41); and a pixel-exact descriptor (`matchTemplate` slides, a fixed vector
does not, so a 1px grid-origin shift destroys it. Downsampling to 16×16 blurs
that jitter away).

**Adding items is now a data change, not a code change:** drop a full-slot RGBA
crop into `templates/` and it is picked up. What is *not* proven is
discrimination at scale, this has already been re-measured at 26 items: the verify threshold had to be raised (an
out-of-catalog Extreme Gold Potion scored 0.753 against the Green template) and the shortlist's
recall is now pinned by a test rather than a hope. See `classify.py`.

## Running it

```bash
cd vision
pip install -r requirements.txt          # to run it
uvicorn app.main:app --port 8000

pip install -r requirements-dev.txt      # to work on it: adds pytest, httpx, ruff
pytest tests/            # the CV regression corpus: the 3-screenshot corpus is the regression suite
ruff check . && ruff format .            # also enforced on commit
```

(This block used to say `pip install -r requirements.txt` and then `pytest tests/`,
which never worked. Pytest was declared nowhere, so the tests only ran if you
happened to have it already. Hence `requirements-dev.txt`.)

`app/cv/build_font.py` and `build_icons.py` regenerate `app/cv/templates/` and
only need re-running if the client changes its artwork.

Runtime dependency: **tesseract-ocr** (installed in the Dockerfile). Used for
the HUD only, never for the stack counts.
