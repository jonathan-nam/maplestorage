"""Compose inventory slots with known counts, to test the reader beyond our 16 samples.

We only have three real screenshots, which between them pin down 68 counts. That
is thin, and it leaves the *decoder* -- glyph advance, overlap suppression, the
outline gate -- barely exercised: both bugs found so far ("10" -> "101", "1482" ->
"4482") were decoder bugs, not pixel bugs, and a wider sweep of numbers is exactly
what would have caught them.

So we render arbitrary counts using the font's real metrics (learned from the
labelled counts: 8px advance, 5px for '1', fixed y) onto real icon art lifted from
slots that draw no count of their own. The digits are real client pixels over a
real client background; only the *number* is synthetic.

Caveat, stated plainly: the glyphs pasted here are the same glyphs the reader
correlates against, so this cannot prove the pixel matching works -- the three real
screenshots do that. What it does prove is that the decoding logic handles digit
combinations the real screenshots never contained.
"""

import numpy as np

ADVANCE = {d: 8 for d in "0234567890"}
ADVANCE["1"] = 5  # '1' is a narrower glyph, and the font is proportional

GLYPH_X0 = 2  # left edge of the count within the slot
GLYPH_Y = 29  # top of the glyph band within the slot; fixed in 132/132 samples


def draw_count(cell: np.ndarray, count: str, font: dict) -> np.ndarray:
    """Paste `count` into a 46x46 slot using the client's own glyphs."""
    out = cell.copy()
    x = GLYPH_X0
    for ch in count:
        glyph = font[ch]
        h, w = glyph.shape[:2]
        alpha = (glyph[:, :, 3:4].astype(np.float32)) / 255.0
        y0, y1, x0, x1 = GLYPH_Y, GLYPH_Y + h, x, x + w
        if y1 > out.shape[0] or x1 > out.shape[1]:
            break
        patch = out[y0:y1, x0:x1].astype(np.float32)
        out[y0:y1, x0:x1] = (glyph[:, :, :3] * alpha + patch * (1 - alpha)).astype(np.uint8)
        x += ADVANCE[ch]
    return out
