"""Whether a new template may join the catalog.

Adding an item is the one catalog operation that can break parses that already worked. A
template too close to one already present does not fail loudly: it gives the verifier two
icons it cannot tell apart, and it will sometimes pick the wrong one, confidently. That is
the failure this project exists to prevent, arriving through the front door.

So a candidate is admitted only if the verifier could tell it apart from everything it will
be classified alongside. The question is asked with the verifier's own two gates
(classify._verify), of two templates rather than of a template and a slot.

This lived in tests/test_catalog.py, which was the only caller while the catalog was
hand-edited. It moves here because a user-submitted item has to be asked the same question
at upload time, and a runtime check that merely resembled the CI one would eventually
disagree with it.
"""

from dataclasses import dataclass

import cv2
import numpy as np

from .classify import MAX_LAB_DISTANCE, VERIFY_THRESHOLD, _colour_distance
from .grid import NATIVE_PITCH


class NotNativeScale(ValueError):
    """The source screenshot was rescaled, so its pixels are not the client's."""


def require_native_scale(pitch: float) -> None:
    """Refuse to author anything from a rescaled capture.

    Parsing tolerates a rescaled capture (the catalog is scaled up to meet the frame), but
    AUTHORING from one poisons the catalog permanently: a template is supposed to BE the
    client's pixels, and a resampled one is a blurred guess at them.

    Measured on the Grandis tokens, cutting from a real 1.326x Parsec capture and scoring
    against a native screenshot: 0.84-0.91, where a client-cut template scores 1.000. Barely
    over the 0.80 verify bar, and fatal for items that come in families. Cut from that
    capture, the Arcane and Sacred Symbols matched the WRONG symbol (0.87) better than
    themselves (0.85). Not a failure to identify, a confident misidentification.

    So this refuses early and by pitch alone. The alternative is one user being told to send
    a better screenshot, against every user silently getting wrong counts.
    """
    if abs(pitch - NATIVE_PITCH) > 0.5:
        raise NotNativeScale(
            f"slot pitch is {pitch:.1f}px, not the client's native {NATIVE_PITCH:.0f}px. "
            "this screenshot has been rescaled, so its pixels are not the client's and a "
            "template cut from it would be a blur. Templates must come from a native-scale "
            "capture (MapleStory's own in-game screenshot always is, even over remote play)."
        )


@dataclass(frozen=True)
class Clash:
    """A catalog item the verifier could not tell the candidate apart from."""

    key: str
    shape: float
    colour: float | None

    def __str__(self) -> str:
        c = "n/a" if self.colour is None else f"{self.colour:.1f}"
        return (
            f"{self.key}: shape={self.shape:.3f} (bar {VERIFY_THRESHOLD}), "
            f"colour={c} (bar {MAX_LAB_DISTANCE})"
        )


def masked_score(slot: np.ndarray, tpl: np.ndarray) -> float:
    """How well `tpl` matches `slot`, under tpl's own mask.

    The argument order mirrors the verifier: a template is correlated against the pixels a
    slot holds, masked by the template. Passing two templates asks "if a slot held `slot`,
    how well would `tpl` match it".
    """
    h = min(slot.shape[0], tpl.shape[0])
    w = min(slot.shape[1], tpl.shape[1])
    slot_rgb = slot[:h, :w, :3].astype(np.uint8)
    tpl_rgb = tpl[:h, :w, :3].astype(np.uint8)
    mask = cv2.cvtColor(tpl[:h, :w, 3], cv2.COLOR_GRAY2BGR)

    res = cv2.matchTemplate(slot_rgb, tpl_rgb, cv2.TM_CCOEFF_NORMED, mask=mask)
    res[~np.isfinite(res)] = -1.0
    return float(res.max())


def _confusable(slot: np.ndarray, tpl: np.ndarray) -> tuple[float, float | None] | None:
    """(shape, colour) when `tpl` would pass BOTH gates against a slot holding `slot`.

    Both must fail to separate them, because either alone has a blind spot the catalog
    already exercises: shape correlates Extreme Blue and Green at 0.925, and colour cannot
    separate the blue potion from kalos-token at 0.4 degrees of hue. See
    classify.MAX_LAB_DISTANCE for the measurements.
    """
    shape = masked_score(slot, tpl)
    if shape < VERIFY_THRESHOLD:
        return None
    colour = _colour_distance(tpl, slot[: tpl.shape[0], : tpl.shape[1], :3])
    if colour is not None and colour > MAX_LAB_DISTANCE:
        return None
    return shape, colour


def clashes(candidate: np.ndarray, catalog: dict[str, np.ndarray]) -> list[Clash]:
    """Every catalog item the candidate cannot be safely admitted alongside. Empty means admit.

    Checked in BOTH directions, because a masked correlation is not symmetric (each side
    supplies its own mask) and the two directions are different bugs:

        candidate in the slot, catalog template matching it -> the new item is reported as
        the old one, and the user who added it never sees their own item.

        catalog item in the slot, candidate matching it -> the new item steals slots from an
        established one, changing counts for people who never added anything.

    The second is the worse of the two and is the one a single-direction check misses.
    """
    out = []
    for key, tpl in sorted(catalog.items()):
        hit = _confusable(candidate, tpl) or _confusable(tpl, candidate)
        if hit:
            out.append(Clash(key=key, shape=hit[0], colour=hit[1]))
    return out
