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
| `POST /parse` | Raw image bytes in. Returns `ScreenshotParseResult` (same shape as the Kotlin DTO). |

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

## The open decision: character attribution

**`characterHud` is always `null`.** Nothing in the CV pipeline reads the
character's name or level off the HUD — that was never part of the spike.

This matters, because `ScreenshotIngestion` currently routes to `NEEDS_REVIEW`
whenever `characterHud == null`. Wiring this sidecar in as-is would therefore
make **every** upload need review, which is worse UX than the vision path it
replaces. One of these has to happen before it ships:

1. **Keep a small vision call for the HUD only.** Crop the HUD region and send
   just that — a few hundred image tokens, roughly $0.001/screenshot instead of
   ~$0.017 for the full frame. Cheapest to build; keeps a Claude dependency.
2. **Read the HUD with CV.** Harder than the counts: the name is an arbitrary
   IGN in a proportional font, not a fixed 10-glyph digit set. Unproven.
3. **Trust the pin when the HUD is absent.** The upload UI already has a
   character-pin panel. This is a product call, not an engineering one — it
   removes the cross-check that stops a screenshot being attributed to the
   wrong character.

Not choosing is not an option; the current default (1) is the safe interim.

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
pytest tests/            # 8 tests: the 3-screenshot corpus is the regression suite
```

`app/cv/build_font.py` and `build_icons.py` regenerate `app/cv/templates/` and
only need re-running if the client changes its artwork.
