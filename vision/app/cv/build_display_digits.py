"""Recolour the OCR digit templates into legible display glyphs for the inventory count.

    python vision/app/cv/build_display_digits.py

templates/digit_*.png are greyscale + mask, built by build_font.py for template MATCHING, where the
dark outline carries the signal and the fill is left dim. Rendered as-is on the app's light
inventory slot they read as dark numbers speckled with white (the dim fill), the opposite of the
game, which draws the count as a bright white fill with a thin dark outline (see
reference-images/inventory804x550.png).

So the DISPLAY copy the backend serves at /digit-icons is recoloured from the same glyphs: the dark
outline becomes navy, the bright stroke fill becomes white, and everything else stays transparent.
The matching templates are NOT touched, so parsing is unaffected; only what the inventory draws changes.

Colour off the GREY, not the mask. The mask covers the glyph's outline plus every region the outline
encloses, which includes a digit's holes (the middle of 0, 8) and its concavities (the bottom-left of
4). Painting all of that white drew a white box in the space the number does not occupy. The grey tells
fill from hole where the mask cannot: the stroke fill sits at ~235+ and the holes/background at ~226,
so a threshold in that gap keeps the fill white and lets the slot show through the rest. build_font's
docstring notes this gap is too small to MATCH on reliably; for DISPLAY it only has to look right, and
a hole left one shade too dark is invisible where a hole painted white is not.
"""

import pathlib

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[3]
TEMPLATES = ROOT / "vision" / "app" / "cv" / "templates"
DISPLAY = ROOT / "backend" / "src" / "main" / "resources" / "seed-assets" / "digits"

OUTLINE_MAX = 100  # grey at or below this is the dark outline -> navy
FILL_MIN = 232  # grey at or above this is the bright stroke fill -> white; between the two, a hole
# or concavity the mask swallowed -> left transparent. Fill measures 235+, background/holes 226-229.
WHITE = (255, 255, 255, 255)
NAVY = (28, 40, 66, 255)  # the game's count outline, sampled from the reference inventory


def recolour(src: Image.Image) -> Image.Image:
    src = src.convert("RGBA")
    out = Image.new("RGBA", src.size, (0, 0, 0, 0))
    sp, op = src.load(), out.load()
    for y in range(src.height):
        for x in range(src.width):
            r, _, _, a = sp[x, y]
            if a < 80:  # outside the glyph mask
                continue
            if r < OUTLINE_MAX:
                op[x, y] = NAVY
            elif r >= FILL_MIN:
                op[x, y] = WHITE
            # else: masked but mid-grey, a hole or concavity; leave it transparent
    return out


def main() -> None:
    n = 0
    for tpl in sorted(TEMPLATES.glob("digit_*.png")):
        digit = tpl.stem.removeprefix("digit_")
        recolour(Image.open(tpl)).save(DISPLAY / f"{digit}.png")
        n += 1
    print(f"wrote {n} display digits to {DISPLAY.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
