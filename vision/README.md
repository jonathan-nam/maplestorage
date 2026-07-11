# vision — screenshot parsing sidecar

Parses MapleStory inventory screenshots into token counts with classical CV.
Runs as a **second container in the same ECS task** as the backend, which calls
it over `127.0.0.1:8000`. It is not a separate service: no ALB, no service
discovery, one deploy.

It replaces the Claude-vision call for token counts. The parse is deterministic
OpenCV (`app/cv/`, ported from `spikes/inventory-cv`): no tokens, no network
call, ~0.6s per screenshot, and the same answer every time.

## API

| Route | Behaviour |
| --- | --- |
| `GET /health` | `{"status":"ok","tokens":6,"digits":10}` |
| `POST /parse` | Raw image bytes in. Returns `ScreenshotParseResult` (same shape as the Kotlin DTO): `screenshotType`, `characterHud`, `tokenCounts`. |

`POST /parse` outcomes, and why each is what it is:

| Result | When |
| --- | --- |
| `200` + `screenshotType: "INVENTORY"` | Grid found; `tokenCounts` holds every token detected. |
| `200` + `screenshotType: "UNRECOGNIZED"` | No inventory lattice. Not an error — the same answer the vision model gave for a non-inventory upload. |
| `422` | The screenshot was **downscaled**. The 11px stack-count font does not survive resampling, so we refuse rather than return a plausible wrong number. |
| `400` | Body is empty or not a decodable image. |

Each detected token carries `needsReview` and `iconScore`. `needsReview` is set
when the capture was rescaled (e.g. fractional Windows DPI scaling) — the icons
still match, but the counts are only ~70-77% reliable there, so the read should
go through the existing human checkpoint rather than be trusted.

## Character attribution (solved)

The HUD is read: `characterHud` returns `{name, level}` when a HUD is in frame,
`null` when it is not (a tightly-cropped upload has none, which the backend
already routes to NEEDS_REVIEW). No vision call, no per-screenshot cost.

It works by the opposite method to the stack counts, and that contrast is the
point:

| | Stack counts | Character HUD |
| --- | --- | --- |
| Text | 11px bitmap font, over icon art | ~20px anti-aliased proportional, on a dark plate |
| Tesseract | **2/12** — unusable | **exact** on the raw crop |
| What works | Matching the client's own 10 glyphs | Tesseract, with no preprocessing at all |

Every binarisation we tried made the HUD *worse* (`acornacom`, `Lv.28/7`), so
`hud.py` feeds Tesseract the raw pixels. Glyph templates were never an option
here anyway: an IGN is arbitrary text, so the alphabet is ~62 glyphs, and we
have one HUD sample containing five distinct letters.

Locating the HUD is the part classical CV does well. It is anchored to the *game
window*, not the screenshot, so its position moves — but the client draws `Lv.`
at a fixed pixel size, so we match that prefix (score 1.000, and 0.998 through
JPEG q92) and read the line beside it.

**Caveat worth keeping in view:** exactly one of our three screenshots has a HUD,
so the corpus proves the *mechanism*, not the *alphabet*. Tesseract read
`acornacorn` exactly, but no IGN with unusual glyphs, mixed case, or digits has
been tested. The first misread IGN will show up as a name that does not match the
roster — which lands in the existing one-click confirm flow rather than corrupting
data, so the failure mode is safe. Collect a few more HUDs before trusting it
blindly.

## Known limit: the catalog does not scale yet

Icon matching is **O(N) in catalog size** — one `matchTemplate` per token across
the grid. Fine at 6 tokens (~0.4s), unusable at a real item catalog:

| Catalog | Current | A per-cell nearest-neighbour lookup would be |
| --- | --- | --- |
| 6 | ~0.4s | 0.1ms |
| 50 | ~4s | 4ms |
| 500 | ~38s | 12ms |

Two attempts at the fix have already failed and are worth not repeating:
exact pixel-hashing of each cell (the slot background has a per-row gradient, so
the same icon hashes differently — 302 distinct hashes across 308 slots, zero
collisions), and a nearest-neighbour descriptor where each cell computed its own
mask (which compares different pixel sets, scoring 0/5). A **fixed-mask**
nearest-neighbour is the likely answer but is **unvalidated**. Solve this before
adding items.

## Running it

```bash
cd vision
pip install -r requirements.txt
uvicorn app.main:app --port 8000
pytest tests/            # 11 tests: the 3-screenshot corpus is the regression suite
```

`app/cv/build_font.py` and `build_icons.py` regenerate `app/cv/templates/` and
only need re-running if the client changes its artwork.

Runtime dependency: **tesseract-ocr** (installed in the Dockerfile) — used for
the HUD only, never for the stack counts.
