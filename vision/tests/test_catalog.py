"""The catalog's own health, independent of any screenshot.

Two failures get worse as the catalog grows, and both are silent:

  * A template that no manifest entry names, or an entry with no template. That is the
    drift that already cost days, the parser emitted `kalos-token` while the lookup
    matched a display name, so every count was dropped without a word.

  * Two icons similar enough that the verifier cannot tell them apart. At six tokens
    this is theoretical. At the scale of a general item catalog it is not: potions,
    scrolls and cubes come in families that differ by a few pixels of colour, and a
    misidentification does not error, it reports the wrong item, confidently.
"""

import pathlib

import cv2
import numpy as np
import pytest
import yaml

from app.cv import classify as classify_mod
from app.cv.classify import MAX_LAB_DISTANCE, VERIFY_THRESHOLD, _colour_distance
from app.cv.grid import find_grid
from app.cv.match import load_templates

ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
MANIFEST = ROOT / "catalog" / "items.yaml"

REF = "../test-fixtures"
REFERENCE_CAPTURES = [
    f"{REF}/untradeables sample.png",
    f"{REF}/inventory sample.png",
    f"{REF}/potions.png",
    f"{REF}/inventory804x550.png",
    f"{REF}/symbols.png",
]


def manifest_keys() -> set[str]:
    return {i["key"] for i in yaml.safe_load(MANIFEST.read_text())["items"]}


def test_every_manifest_item_has_a_template():
    templates = load_templates()
    missing = manifest_keys() - set(templates)
    assert not missing, (
        f"in the manifest but with no template the parser can match: {sorted(missing)}"
    )


def test_every_template_is_in_the_manifest():
    templates = load_templates()
    orphans = set(templates) - manifest_keys()
    assert not orphans, (
        f"templates the parser can detect but the app cannot name: {sorted(orphans)}. "
        "An orphan template is a silent mismatch waiting to happen. Add it to catalog/items.yaml."
    )


def _masked_score(a: np.ndarray, b: np.ndarray) -> float:
    """How well template `a` matches template `b`, using b's own mask, i.e. exactly the
    question the verifier asks of a real slot."""
    h = min(a.shape[0], b.shape[0])
    w = min(a.shape[1], b.shape[1])
    a_rgb = a[:h, :w, :3].astype(np.uint8)
    b_rgb = b[:h, :w, :3].astype(np.uint8)
    mask = cv2.cvtColor(b[:h, :w, 3], cv2.COLOR_GRAY2BGR)

    res = cv2.matchTemplate(a_rgb, b_rgb, cv2.TM_CCOEFF_NORMED, mask=mask)
    res[~np.isfinite(res)] = -1.0
    return float(res.max())


def test_no_two_templates_are_confusable():
    """No icon may pass BOTH of the verifier's tests against a different icon.

    The verifier is two tests, not one: masked correlation on shape, then mean a*/b* on
    colour. Either alone has a blind spot, and the catalog exercises both:

      * Extreme Blue and Extreme Green are one bottle in two colours. Shape correlates
        them at 0.925 against a 0.55 bar. Shape cannot tell them apart at all.
      * The blue potion and kalos-token are 0.4 degrees apart in hue. Colour cannot tell
        THOSE apart.

    So an icon is only genuinely confusable with another if it clears the shape bar AND
    lands inside the colour distance. This test used to check shape alone and failed the
    moment the potions arrived. Correctly reporting a clash that the verifier, as it now
    stands, does not actually have.
    """
    templates = load_templates()
    names = sorted(templates)

    clashes = []
    for i, a in enumerate(names):
        for b in names[i + 1 :]:
            shape = _masked_score(templates[a], templates[b])
            if shape < VERIFY_THRESHOLD:
                continue  # shape already separates them

            # Same question the verifier asks: is B's colour close enough to A's to pass?
            colour = _colour_distance(templates[a], templates[b][:, :, :3])
            if colour is None or colour <= MAX_LAB_DISTANCE:
                clashes.append((a, b, shape, colour))

    assert not clashes, "icons the verifier cannot tell apart:\n" + "\n".join(
        f"    {a} vs {b}: shape={s:.3f} (bar {VERIFY_THRESHOLD}), "
        f"colour={'n/a' if c is None else f'{c:.1f}'} (bar {MAX_LAB_DISTANCE})"
        for a, b, s, c in clashes
    )


@pytest.mark.parametrize("key", sorted(manifest_keys()))
def test_a_template_matches_itself_perfectly(key):
    """Sanity: the client draws each icon pixel-identically, so a template must score
    ~1.0 against itself. A template that does not is corrupt, or was cut with the wrong
    mask, and will never be found in a real screenshot either."""
    templates = load_templates()
    assert _masked_score(templates[key], templates[key]) > 0.99


# --- The shortlist must actually shortlist the right answer -------------------------------
#
# classify() is two stages: a cheap descriptor RANKS all N catalog items for each slot, and
# only the top TOP_K are handed to the exact verifier. If the true item is not in that top-K,
# the verifier never sees it and the item silently does not exist. There is no error, no low
# score, no warning, the count is simply absent, and an undercount is the one failure this
# project exists to prevent.
#
# This has now bitten twice. At 6 items TOP_K was 3 and Aurelia's Elixir, a pixel-perfect
# 1.000 match, vanished. At 13 items TOP_K was 8 and the symbol coupons pushed it over
# again. Both times the number was raised and a comment was written telling the next person to
# re-measure, and both times nobody did, because nothing forced them to.
#
# So this is the forcing function. It does not check counts; it checks the PROPERTY that makes
# the shortlist sound. Add items to the catalog and this fails long before a user sees a wrong
# number.
@pytest.mark.parametrize("scale", [1.0, 1.25, 1.5])
def test_the_shortlist_never_drops_the_true_item(scale):
    templates = load_templates()
    names, cat = classify_mod.build_catalog(templates)

    worst_rank, worst_where = 0, None
    checked = 0
    for path in REFERENCE_CAPTURES:
        base = cv2.imread(path)
        assert base is not None, path
        img = (
            base
            if scale == 1.0
            else cv2.resize(base, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
        )
        g = find_grid(img)
        cells = classify_mod.slot_cells(img, g)
        bg = classify_mod.background(cells, round(g.pitch))
        scaled = classify_mod.scale_templates(templates, g.scale)

        for (r, c), cell in cells.items():
            # Ground truth for this slot: the item the EXACT verifier picks when it is shown
            # every template, with no shortlist in the way.
            score, name = max(
                ((classify_mod._verify(img, g, r, c, scaled[n]), n) for n in names),
                key=lambda t: t[0],
            )
            if score < 0.90:
                continue  # empty, or an item we have no template for
            checked += 1

            order = np.argsort(classify_mod.descriptor(cell, bg) @ cat.T)[::-1]
            rank = int(np.where(np.array(names)[order] == name)[0][0]) + 1
            if rank > worst_rank:
                worst_rank, worst_where = rank, f"{name} at r{r}c{c} in {path}"

    assert checked > 50, f"only {checked} true matches found, the corpus is not exercising this"
    assert worst_rank <= classify_mod.TOP_K, (
        f"the descriptor ranked a true item #{worst_rank} of {len(names)}, outside "
        f"TOP_K={classify_mod.TOP_K}, so classify() would never verify it and the item would "
        f"silently vanish: {worst_where}. Either raise TOP_K or improve the descriptor. Do "
        f"not delete this test."
    )
