# Classical-CV spike: inventory token detection + count OCR

Spike answering whether the 6-token catalog can be read off an inventory
screenshot with classical CV instead of a vision LLM, after the Claude-vision
path proved unreliable.

**It can, exactly.** On the three real screenshots we have, the pipeline reads
**16/16 token counts correctly, with no false positives** across 128 slots x 6
tokens. It needs no model, no network call, and runs in well under a second.

| screenshot | tokens present | counts correct |
| --- | --- | --- |
| `untradeables sample.png` (2359x1095) | 5 | 5/5 |
| `inventory sample.png` (3280x1880) | 5 | 5/5 |
| `inventory804x550.png` (m3 branch) | 6 | 6/6 |

## Why it works

MapleStory's inventory is drawn at **fixed pixel size** — the slot pitch is 46px
whether the client sits on a 2359px or a 3280px desktop. And the client renders
each item icon **pixel-identically** every time. So this is not really a
recognition problem; it is a lookup problem, once you find the grid.

The pipeline is three stages:

1. **`grid.py` — find the 16x8 slot lattice.** A slot's interior is a flat grey
   (~226) and every slot boundary is a fixed ridge whose dark flanks fall outside
   that grey band, so thresholding to the interior *severs the cells from each
   other* and each slot drops out as its own connected component. Fitting a
   lattice to those boxes gives the pitch (= the screenshot's scale) and the
   origin. Other UI on screen (quick-slot bars, the Maple Planner) also produces
   square grey boxes, so we keep only the cells sharing one lattice phase and take
   the largest contiguous block.

2. **`match.py` — classify each slot against the 6 icons.** Correlate at the one
   scale the grid gave us, with an alpha mask so transparent icon pixels don't
   count, then attribute each response to the slot its centre lands in.

3. **`ocr.py` — read the stack count.** Correlate the client's own digit glyphs
   over the count band, then decode left-to-right.

## What we learned (the non-obvious parts)

**Naive multi-scale template matching does not work,** and this is the trap worth
recording. Sliding the 6 icons over the whole image across a range of scales
collapses as soon as the image is not at native scale: at 0.85x the separation
between a token that is present and one that is absent goes to **-0.02** — i.e. a
wrong-scale template finds spurious correlation somewhere and the absent token
scores as high as the real ones. The fix is to remove both degrees of freedom:
the grid pins the scale, and per-slot attribution pins the location. Margin then
goes to **+0.66**.

**Tesseract is not usable here — it scores 2/12.** The counts are an 11px
proportional bitmap font drawn *over arbitrary icon art*, nothing like the scanned
text Tesseract is trained for. Neither an outline binarisation (0/12) nor a
hole-filled one (2/12) rescues it. Matching the ten known glyphs instead gives
**68/68 (100%)** on hand-labelled counts. Two details were load-bearing:

- The digit *fill* (~235) is nearly the same value as the slot background (226),
  so no threshold separates them. The black outline is the only reliable signal,
  and each glyph's mask must cover only its own pixels so the icon art behind the
  digits stays out of the correlation.
- Decoding must advance by the accepted glyph's width. `1` is 5px wide and
  correlates happily with the vertical stroke *inside* a `0`, so "10" reads as
  "101" under plain non-max suppression. A `4` will also outscore a `1` sitting
  under it ("1482" -> "4482"), so a candidate must additionally land on the
  outline pixels that are really there.

**Icons must be cut from the client, not from the web prototype.** The prototype's
artwork scores 0.61–0.93; templates cut from a real screenshot score a flat
**1.000** on held-out screenshots. Distorted Ambition in particular sat at 0.61
against a 0.55 threshold and was the first token to vanish under JPEG.

## Player resolution, and tokens kept anywhere

Both of these were raised as objections; both were tested rather than assumed.

**Tokens can sit in any slots.** Nothing in the pipeline couples the tokens to
each other: `find_tokens` takes an independent argmax per token over all 128
slots. They happened to be adjacent in all three sample screenshots, so that was
worth proving — synthetically relocating all six tokens to random, non-adjacent
slots gives **8/8 trials with the right token in the right slot with the right
count**. Layout is a non-issue.

**Game resolution is also a non-issue, and for a specific reason:** the client
draws its UI at a *fixed pixel size*. The slot pitch measures exactly 46px on
every screenshot we have, across a 4x range of desktop pixel counts (804x550 crop,
2359x1095, 3280x1880). Playing at a different resolution changes how much scenery
surrounds the inventory, not how big the inventory is drawn. And the grid detector
*measures* the pitch rather than assuming it, so it notices if this ever stops
being true.

**What does change the scale is the capture, not the game**: Windows display
scaling, a HiDPI/Retina grab, stretched fullscreen, or a resize before upload.
`normalize()` resamples the pitch back to 46 — but how well the counts survive
depends on the ratio, and this is the honest picture (measured on a synthetically
rescaled screenshot, LANCZOS4 resampling):

| capture | counts correct | handling |
| --- | --- | --- |
| native 46px (any game resolution) | **100%** | trusted |
| 2.0x (HiDPI) | 100% | normalized, trusted |
| 1.5x (Windows 150%) | 100% | normalized, but flagged |
| 1.25x (Windows 125%) | ~77% | **flagged for review** |
| 1.1x | ~70% | **flagged for review** |
| below native | — | rejected outright |

Icon *detection* survives any of these (6/6 tokens found even at 1.25x) — the
icons are large and distinctive. The *counts* are what degrade: a fractional
rescale interpolates the 11px font into mush, and no resampling kernel brings it
back. So rather than emit a plausible wrong number, `parse()` sets
`needs_review` on those reads, which is exactly the human checkpoint M3's upload
UI already has. Silent wrongness is the one outcome that is not acceptable here.

Caveat worth stating plainly: **we have no real DPI-scaled screenshot.** The
1.25x row above is a model (bicubic upscale, which is what Windows does to a
non-DPI-aware app), not a measurement. If MapleStory turns out to be DPI-aware it
would render natively and the whole row is moot. Getting one real screenshot from
a 125%-scaling laptop would settle it, and is the single highest-value sample to
collect next.

## The constraint this puts on the app

**Uploads must not be downscaled.** The 11px font does not survive resampling —
at **0.95x every count already reads as garbage**. `frontend/lib/compress-image.ts`
currently shrinks uploads to save vision-LLM tokens; classical CV has no token
cost, so that resize has to go (or be bounded to "never below native"). JPEG
*compression* is fine — counts still read 5/5 at quality 40 — so compressing
without resizing is safe and keeps uploads small.

`parse(img, strict=True)` enforces this: it refuses a screenshot whose pitch is
not 46px rather than quietly returning null counts.

## Limits / what is not yet proven

- Three screenshots is a thin sample, though the scatter and rescale tests above
  are synthetic extensions of them.
- No real DPI-scaled capture has been tested (see above). This is the biggest
  open risk and the cheapest one to close.
- Only the tokens' own slots are read. Nothing here identifies the character, so
  screenshot-to-character attribution still needs the existing mechanism.
- The count band assumes the untradeable bar sits below it. Tokens are always
  untradeable, so this holds for the catalog, but it is an assumption.

## Running it

```bash
python3 -m venv .venv-cv && .venv-cv/bin/pip install -r spikes/inventory-cv/requirements.txt
cd spikes/inventory-cv
../../.venv-cv/bin/python pipeline.py "../../reference-images/untradeables sample.png" --debug
```

`build_font.py` and `build_icons.py` regenerate `templates/` and only need to be
re-run if the client changes its artwork.
