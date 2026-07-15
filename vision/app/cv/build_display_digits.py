"""Recolour the OCR digit templates into legible display glyphs for the inventory count.

    python vision/app/cv/build_display_digits.py

templates/digit_*.png are greyscale + mask, built by build_font.py for template MATCHING, where the
dark outline carries the signal and the fill is left dim. Rendered as-is on the app's light
inventory slot they read as dark numbers speckled with white (the dim fill), the opposite of the
game, which draws the count as a bright white fill with a thin dark outline (see
reference-images/inventory804x550.png).

So the DISPLAY copy the backend serves at /digit-icons is recoloured from the same glyphs: every
masked pixel becomes white (fill) or navy (outline), split on the template's own grey. The matching
templates are NOT touched, so parsing is unaffected; only what the inventory draws changes.
"""

import pathlib

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[3]
TEMPLATES = ROOT / "vision" / "app" / "cv" / "templates"
DISPLAY = ROOT / "backend" / "src" / "main" / "resources" / "seed-assets" / "digits"

# Split fill from outline on the template's grey. The outline sits near black and the fill well
# above it, so anything this dark is outline. Measured off the built templates, not guessed.
OUTLINE_MAX = 100
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
            op[x, y] = NAVY if r < OUTLINE_MAX else WHITE
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
